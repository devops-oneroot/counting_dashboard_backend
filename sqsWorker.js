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
const VISIBILITY_TIMEOUT = 300; // 5 minutes - gives enough time to approve

let latestMessage = null;
let messageTimestamp = null; // Track when message was fetched
let lastProcessedMessage = null; // Track last processed message for deduplication

/** ⭐ SAFE PARSER */
function parseBody(body) {
  try {
    const first = JSON.parse(body);
    if (typeof first === "string") return JSON.parse(first);
    return first;
  } catch (err1) {
    console.log("❌ First parse failed:", err1.message);

    try {
      const fixed = body.replace(/\n/g, "").replace(/"(\d+),/g, '"$1",');
      return JSON.parse(fixed);
    } catch (err2) {
      console.log("❌ Second parse failed:", err2.message);
      return null;
    }
  }
}

/** Check if current message is expired */
function isMessageExpired() {
  if (!latestMessage || !messageTimestamp) {
    return true;
  }

  const now = Date.now();
  const elapsed = (now - messageTimestamp) / 1000; // seconds

  // Expire 10 seconds before actual timeout to be safe
  const isExpired = elapsed > VISIBILITY_TIMEOUT - 10;

  if (isExpired) {
    console.log(
      `⚠️ Message expired (${elapsed.toFixed(0)}s > ${VISIBILITY_TIMEOUT}s)`,
    );
  }

  return isExpired;
}

/** Check if message is duplicate of last processed one */
function isDuplicate(parsedBody) {
  if (!lastProcessedMessage || !parsedBody) {
    return false;
  }

  const duplicate =
    lastProcessedMessage.truck_number === parsedBody.truck_number &&
    lastProcessedMessage.count === parsedBody.count;

  if (duplicate) {
    console.log(
      `🔄 DUPLICATE DETECTED: Truck ${parsedBody.truck_number}, Count ${parsedBody.count}`,
    );
  }

  return duplicate;
}

/** 🔁 poll with automatic duplicate skipping */
export async function pollSQS(forcePoll = false, maxRetries = 10) {
  let retries = 0;

  while (retries < maxRetries) {
    console.log(
      `📡 Polling SQS... ${forcePoll ? "(FORCE MODE)" : ""} [Attempt ${retries + 1}/${maxRetries}]`,
    );

    // If force mode, use shorter visibility timeout to avoid blocking queue
    const visibilityTimeout = forcePoll ? 30 : VISIBILITY_TIMEOUT;

    const res = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 10,
        VisibilityTimeout: visibilityTimeout,
      }),
    );

    console.log("📥 Raw SQS response:", JSON.stringify(res, null, 2));

    if (!res.Messages?.length) {
      console.log("⚠ No messages found in queue.");
      console.log("💡 Possible reasons:");
      console.log("   • Queue is empty");
      console.log(
        "   • Messages are in-flight (invisible due to previous fetch)",
      );
      console.log("   • Messages are delayed");
      latestMessage = null;
      messageTimestamp = null;
      return null;
    }

    const msg = res.Messages[0];

    console.log("📩 Received Message ID:", msg.MessageId);
    console.log("📦 Raw Body:", msg.Body);

    const parsedBody = parseBody(msg.Body);

    console.log("🧠 Parsed Body:", parsedBody);

    if (!parsedBody) {
      console.log("❌ Parsed body is NULL");
      // Delete invalid message and try next
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: msg.ReceiptHandle,
        }),
      );
      console.log("🗑️ Invalid message deleted, fetching next...");
      retries++;
      continue;
    }

    // Check for duplicate
    if (isDuplicate(parsedBody)) {
      console.log(
        "🔄 Duplicate message detected! Auto-deleting and fetching next...",
      );

      // Delete the duplicate
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: msg.ReceiptHandle,
        }),
      );

      console.log("✅ Duplicate deleted, fetching next message...");
      retries++;
      continue; // Fetch next message
    }

    // Valid unique message found
    latestMessage = {
      id: msg.MessageId,
      body: parsedBody,
      receipt: msg.ReceiptHandle,
    };

    messageTimestamp = Date.now(); // Track when we got this message

    console.log(
      `✅ Latest message stored (visibility: ${visibilityTimeout}s):`,
      latestMessage,
    );

    return latestMessage;
  }

  // Max retries reached
  console.log(
    `⚠️ Max retries (${maxRetries}) reached. No unique message found.`,
  );
  return null;
}

/** 📤 get message */
export function getMessage() {
  console.log("📦 getMessage called. Current value:", latestMessage);

  if (!latestMessage) {
    console.log("⚠ latestMessage is NULL");
    return null;
  }

  // Check if message has expired
  if (isMessageExpired()) {
    console.log("⚠️ Cached message has expired, clearing it");
    latestMessage = null;
    messageTimestamp = null;
    return null;
  }

  return latestMessage;
}

/** ✅ approve */
export async function approveMessage(receipt) {
  if (!receipt) {
    console.log("❌ No receipt provided to approveMessage");
    throw new Error("No receipt handle provided");
  }

  console.log("🗑 Deleting message with receipt:", receipt);

  try {
    await client.send(
      new DeleteMessageCommand({
        QueueUrl: QUEUE_URL,
        ReceiptHandle: receipt,
      }),
    );

    console.log("✅ Message deleted successfully.");

    // Save the last processed message for duplicate detection
    if (latestMessage?.body) {
      lastProcessedMessage = {
        truck_number: latestMessage.body.truck_number,
        count: latestMessage.body.count,
      };
      console.log("💾 Saved for deduplication:", lastProcessedMessage);
    }

    latestMessage = null;
    messageTimestamp = null;
  } catch (e) {
    console.log("❌ Delete error:", e.message);

    // If receipt is invalid/expired, clear the cached message
    if (
      e.message?.includes("ReceiptHandle") ||
      e.name === "ReceiptHandleIsInvalid"
    ) {
      console.log("⚠️ Receipt handle expired or invalid, clearing cache");
      latestMessage = null;
      messageTimestamp = null;
      throw new Error("Message receipt expired. Please fetch a new message.");
    }

    throw e;
  }
}

/** 🧹 purge all */
export async function deleteAllMessages() {
  console.log("⚠ Purging entire queue...");

  await client.send(
    new PurgeQueueCommand({
      QueueUrl: QUEUE_URL,
    }),
  );

  latestMessage = null;
  messageTimestamp = null;
  lastProcessedMessage = null; // Reset deduplication tracking

  console.log("✅ All messages deleted. Cache and deduplication reset.");
}

/** 📊 Get queue statistics */
export async function getQueueStats() {
  const { GetQueueAttributesCommand } = await import("@aws-sdk/client-sqs");

  const result = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl: QUEUE_URL,
      AttributeNames: ["All"],
    }),
  );

  const attrs = result.Attributes;

  return {
    available: parseInt(attrs.ApproximateNumberOfMessages || "0"),
    inFlight: parseInt(attrs.ApproximateNumberOfMessagesNotVisible || "0"),
    delayed: parseInt(attrs.ApproximateNumberOfMessagesDelayed || "0"),
    visibilityTimeout: parseInt(attrs.VisibilityTimeout || "30"),
  };
}

/** 🔄 Reset deduplication tracking */
export function resetDeduplication() {
  console.log("🔄 Resetting deduplication tracking...");
  lastProcessedMessage = null;
  console.log("✅ Deduplication reset. Next message will not be compared.");
}
