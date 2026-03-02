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
dotenv.config();

const client = new SQSClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

const QUEUE_URL = process.env.SQS_URL;

let latestMessage = null;

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
      WaitTimeSeconds: 10,
      VisibilityTimeout: 120,
    }),
  );

  if (!res.Messages?.length) {
    latestMessage = null;
    return null;
  }

  const msg = res.Messages[0];

  latestMessage = {
    id: msg.MessageId,
    body: parseBody(msg.Body), // ⭐ IMPORTANT → object now
    receipt: msg.ReceiptHandle,
  };

  return latestMessage;
}

export function getMessage() {
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
  } catch (e) {
    // ⭐ receipt expired → get fresh message
    if (e.message?.includes("ReceiptHandle")) {
      console.log("Receipt expired → repolling");
      await pollSQS();
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
}
