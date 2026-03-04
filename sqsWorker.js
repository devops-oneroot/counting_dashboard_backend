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

/** poll */
export async function pollSQS() {
  const res = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 5,
      VisibilityTimeout: 43200, // 12 hours — SQS max; prevents receipt expiry during normal use
    }),
  );

  if (!res.Messages?.length) {
    latestMessage = null;
    await savePending(null);
    return null;
  }

  const msg = res.Messages[0];

  latestMessage = {
    id: msg.MessageId,
    body: parseBody(msg.Body), // ⭐ IMPORTANT → object now
    receipt: msg.ReceiptHandle,
  };

  await savePending(latestMessage);
  return latestMessage;
}

export async function getMessage() {
  await ensureRestored();
  return latestMessage;
}

export async function approveMessage(receipt) {
  if (!receipt) return;

  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: receipt,
      }),
    );

    latestMessage = null;
    await savePending(null);
  } catch (e) {
    if (e.message?.includes("ReceiptHandle")) {
      // Receipt expired: re-fetch to get a fresh receipt, then delete immediately
      console.log("Receipt expired → re-fetching and deleting");
      await pollSQS();

      if (latestMessage?.receipt) {
        await client.send(
          new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: latestMessage.receipt,
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
  await client.send(
    new PurgeQueueCommand({
      QueueUrl: QUEUE_URL,
    }),
  );

  latestMessage = null;
  await savePending(null);
}
