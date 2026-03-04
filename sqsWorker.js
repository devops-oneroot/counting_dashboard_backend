// // backend/sqsWorker.js
// import {
//   SQSClient,
//   ReceiveMessageCommand,
//   DeleteMessageCommand,
//   PurgeQueueCommand, // ✅ correct
// } from "@aws-sdk/client-sqs";

// import dotenv from "dotenv";

// dotenv.config();

// const client = new SQSClient({
//   region: process.env.AWS_REGION,
//   credentials: {
//     accessKeyId: process.env.AWS_ACCESS_KEY,
//     secretAccessKey: process.env.AWS_SECRET_KEY,
//   },
// });

// const QUEUE_URL = process.env.SQS_URL;

// let latestMessage = null;

// /** Poll once */
// export async function pollSQS() {
//   const res = await client.send(
//     new ReceiveMessageCommand({
//       QueueUrl: QUEUE_URL,
//       MaxNumberOfMessages: 1,
//       WaitTimeSeconds: 10,
//       VisibilityTimeout: 120,
//     }),
//   );

//   if (!res.Messages?.length) {
//     latestMessage = null;
//     return null;
//   }

//   const msg = res.Messages[0];

//   latestMessage = {
//     id: msg.MessageId,
//     body: msg.Body,
//     receipt: msg.ReceiptHandle,
//   };

//   console.log("Received:", latestMessage.id);

//   return latestMessage;
// }

// export function getMessage() {
//   return latestMessage;
// }

// export async function approveMessage(receipt) {
//   if (!receipt) throw new Error("Missing receipt handle");

//   try {
//     await client.send(
//       new DeleteMessageCommand({
//         QueueUrl: QUEUE_URL,
//         ReceiptHandle: receipt,
//       }),
//     );

//     latestMessage = null;
//     console.log("Deleted message");
//   } catch (e) {
//     console.log("Delete failed:", e.message);

//     // ⭐ if receipt expired → repoll
//     if (e.message?.includes("ReceiptHandle")) {
//       console.log("Receipt expired → repolling SQS");
//       await pollSQS();
//     }

//     throw e;
//   }
// }

// // ⭐ delete all messages
// export async function deleteAllMessages() {
//   if (!QUEUE_URL) throw new Error("Missing SQS_URL");

//   await client.send(
//     new PurgeQueueCommand({
//       QueueUrl: QUEUE_URL,
//     }),
//   );

//   latestMessage = null;

//   console.log("Queue purged using SQS_URL");
// }
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";

import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
dotenv.config();

const client = new SQSClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const QUEUE_URL = process.env.SQS_URL;
const PENDING_FILE = path.resolve(process.cwd(), "pending_message.json");

let latestMessage = null;

// Persist message to disk so it survives server restarts
async function savePending(msg) {
  if (msg) {
    await fs.writeFile(PENDING_FILE, JSON.stringify(msg));
  } else {
    await fs.unlink(PENDING_FILE).catch(() => {});
  }
}

// Restore persisted message on startup (called lazily on first getMessage())
async function restoreFromDisk() {
  try {
    const raw = await fs.readFile(PENDING_FILE, "utf-8");
    latestMessage = JSON.parse(raw);
    console.log("Restored pending message from disk:", latestMessage?.id);
  } catch {
    // No file or parse error — start fresh
  }
}

let restored = false;
async function ensureRestored() {
  if (!restored) {
    restored = true;
    await restoreFromDisk();
  }
}

/** ⭐ SAFE PARSER */
function parseBody(body) {
  try {
    const first = JSON.parse(body);
    if (typeof first === "string") return JSON.parse(first);
    return first;
  } catch {
    try {
      const fixed = body.replace(/\n/g, "").replace(/"(\d+),/g, '"$1",');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

// Keep the active message invisible for 12 hours by extending visibility periodically
let extendTimer = null;

function startVisibilityExtender(receiptHandle) {
  stopVisibilityExtender();
  // Extend every 10 minutes (well before the 15-min visibility expires)
  extendTimer = setInterval(async () => {
    try {
      await client.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: 900, // extend by another 15 min
        }),
      );
      console.log("Extended visibility for active message");
    } catch (e) {
      console.log("Failed to extend visibility:", e.message);
      stopVisibilityExtender();
    }
  }, 10 * 60 * 1000); // every 10 minutes
}

function stopVisibilityExtender() {
  if (extendTimer) {
    clearInterval(extendTimer);
    extendTimer = null;
  }
}

/** poll */
export async function pollSQS() {
  try {
    const res = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 5,
        VisibilityTimeout: 900, // 15 min initial — extended automatically while active
      }),
    );

    console.log("SQS poll result:", res.Messages?.length ?? 0, "messages");

    if (!res.Messages?.length) {
      // DON'T wipe latestMessage here — only return null to indicate "nothing new"
      return null;
    }

    const msg = res.Messages[0];

    latestMessage = {
      id: msg.MessageId,
      body: parseBody(msg.Body),
      receipt: msg.ReceiptHandle,
    };

    // Auto-extend visibility so the message stays hidden while the operator works on it
    startVisibilityExtender(msg.ReceiptHandle);

    console.log("Polled message:", latestMessage.id);
    await savePending(latestMessage);
    return latestMessage;
  } catch (e) {
    console.error("pollSQS error:", e.message);
    throw e;
  }
}

export async function getMessage() {
  await ensureRestored();
  return latestMessage;
}

export async function approveMessage(receipt) {
  if (!receipt) return;

  stopVisibilityExtender();

  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: receipt,
      }),
    );

    latestMessage = null;
    await savePending(null);
    console.log("Message deleted from SQS");
  } catch (e) {
    if (e.message?.includes("ReceiptHandle")) {
      console.log("Receipt expired → re-fetching and deleting");
      const fresh = await pollSQS();

      if (fresh?.receipt) {
        stopVisibilityExtender(); // stop the one pollSQS just started
        await client.send(
          new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: fresh.receipt,
          }),
        );
        latestMessage = null;
        await savePending(null);
      }
      return;
    }

    throw e;
  }
}

export async function deleteAllMessages() {
  stopVisibilityExtender();

  await client.send(
    new PurgeQueueCommand({
      QueueUrl: QUEUE_URL,
    }),
  );

  latestMessage = null;
  await savePending(null);
}
