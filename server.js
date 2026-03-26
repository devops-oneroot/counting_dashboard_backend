// import express from "express";
// import cors from "cors";
// import dotenv from "dotenv";
// import fs from "fs/promises";
// import path from "path";
// import { connectDB } from "./db.js";
// import Approval from "./models/Approval.js";
// import TodayTotal from "./models/TodayTotal.js";

// dotenv.config();
// connectDB();

// import {
//   pollSQS,
//   getMessage,
//   approveMessage,
//   deleteAllMessages,
//   getQueueStats,
//   resetDeduplication,
// } from "./sqsWorker.js";

// const app = express();
// app.use(cors());
// app.use(express.json());

// const PORT = process.env.PORT || 5000;
// const APPROVALS_FILE = path.resolve(process.cwd(), "approvals.json");

// async function readApprovals() {
//   try {
//     const raw = await fs.readFile(APPROVALS_FILE, "utf-8");
//     return JSON.parse(raw);
//   } catch {
//     return [];
//   }
// }

// async function saveApproval(obj) {
//   const arr = await readApprovals();
//   arr.push(obj);
//   await fs.writeFile(APPROVALS_FILE, JSON.stringify(arr, null, 2));
// }

// /** cached message */
// app.get("/message", (req, res) => {
//   res.json(getMessage());
// });

// /** fetch next - IMPROVED VERSION */
// app.post("/fetch", async (req, res) => {
//   try {
//     // Check if we have a valid cached message
//     const existing = getMessage();

//     if (existing) {
//       console.log("✅ Returning cached message");
//       return res.json(existing);
//     }

//     // No cached message or it expired, poll for new one
//     console.log("📡 No cached message, polling SQS...");
//     const msg = await pollSQS();

//     if (!msg) {
//       console.log("📭 Queue is empty");
//       return res.json({
//         message: "No messages available in queue",
//         empty: true,
//       });
//     }

//     res.json(msg);
//   } catch (e) {
//     console.error("❌ /fetch error:", e.message);
//     res.status(500).json({ error: e.message });
//   }
// });

// /** approve - IMPROVED VERSION */
// app.post("/approve", async (req, res) => {
//   try {
//     const { message, approvedValue } = req.body;

//     if (!message?.receipt) {
//       return res.status(400).json({ error: "No message provided" });
//     }

//     const parsed = message.body;

//     // Try to delete the message from SQS
//     try {
//       await approveMessage(message.receipt);
//     } catch (deleteError) {
//       // If receipt expired, return specific error
//       if (deleteError.message?.includes("expired")) {
//         return res.status(410).json({
//           error: "Message expired. Please fetch a new message.",
//           expired: true,
//         });
//       }
//       throw deleteError;
//     }

//     // Save to database
//     const record = await Approval.create({
//       messageId: message.id,
//       truck_number: parsed?.truck_number,
//       original_count: Number(parsed?.count),
//       approved_count: Number(approvedValue),
//     });

//     // Poll for next message
//     const next = await pollSQS();

//     res.json({ ok: true, record, next });
//   } catch (e) {
//     console.error("❌ /approve error:", e.message);
//     res.status(500).json({ error: e.message });
//   }
// });

// app.put("/approval/:id", async (req, res) => {
//   try {
//     const { approved_count } = req.body;

//     const updated = await Approval.findByIdAndUpdate(
//       req.params.id,
//       { approved_count },
//       { new: true },
//     );

//     res.json(updated);
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

// /** approvals list */
// app.get("/approvals", async (req, res) => {
//   const list = await Approval.find().sort({ createdAt: -1 });
//   res.json(list);
// });

// /** delete all messages */
// app.post("/deleteAll", async (req, res) => {
//   try {
//     await deleteAllMessages();

//     res.json({
//       ok: true,
//       message: "Queue purge requested (may take up to 60s)",
//       queue: process.env.SQS_URL,
//     });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

// /** total count */
// // app.get("/totals/today", async (req, res) => {
// //   try {
// //     const today = new Date().toISOString().split("T")[0];

// //     const start = new Date(today);
// //     start.setHours(0, 0, 0, 0);

// //     const end = new Date(today);
// //     end.setHours(23, 59, 59, 999);

// //     const data = await Approval.aggregate([
// //       {
// //         $match: {
// //           createdAt: { $gte: start, $lte: end },
// //         },
// //       },
// //       {
// //         $group: {
// //           _id: "$truck_number",
// //           totalApproved: { $sum: "$approved_count" },
// //           entries: { $sum: 1 },
// //         },
// //       },
// //       {
// //         $project: {
// //           truck_number: "$_id",
// //           totalApproved: 1,
// //           entries: 1,
// //           _id: 0,
// //         },
// //       },
// //     ]);

// //     const results = [];

// //     for (const item of data) {
// //       const updated = await TodayTotal.findOneAndUpdate(
// //         {
// //           truck_number: item.truck_number,
// //           date: today,
// //         },
// //         {
// //           $set: {
// //             totalApproved: item.totalApproved,
// //             entries: item.entries,
// //           },
// //           $setOnInsert: {
// //             sqsCountComplete: false,
// //           },
// //         },
// //         {
// //           new: true,
// //           upsert: true,
// //         },
// //       );

// //       results.push(updated);
// //     }

// //     res.json({
// //       message: "Today's totals synced successfully",
// //       data: results,
// //     });
// //   } catch (e) {
// //     res.status(500).json({ error: e.message });
// //   }
// // });
// app.get("/totals/today", async (req, res) => {
//   try {
//     const data = await Approval.aggregate([
//       {
//         $group: {
//           _id: "$truck_number",
//           totalApproved: { $sum: "$approved_count" },
//           entries: { $sum: 1 },
//         },
//       },
//       {
//         $project: {
//           truck_number: "$_id",
//           totalApproved: 1,
//           entries: 1,
//           _id: 0,
//         },
//       },
//     ]);

//     const results = [];

//     for (const item of data) {
//       const updated = await TodayTotal.findOneAndUpdate(
//         {
//           truck_number: item.truck_number,
//         },
//         {
//           $set: {
//             totalApproved: item.totalApproved,
//             entries: item.entries,
//           },
//           $setOnInsert: {
//             sqsCountComplete: false,
//           },
//         },
//         {
//           new: true,
//           upsert: true,
//         },
//       );

//       results.push(updated);
//     }

//     res.json({
//       message: "Totals synced successfully",
//       data: results,
//     });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });
// app.put("/totals/complete", async (req, res) => {
//   try {
//     const { date, truck_number } = req.body;

//     if (!date || !truck_number) {
//       return res.status(400).json({ error: "Date and truck_number required" });
//     }

//     const updated = await TodayTotal.findOneAndUpdate(
//       {
//         truck_number,
//         date,
//       },
//       { sqsCountComplete: true },
//       { new: true },
//     );

//     if (!updated) {
//       return res.status(404).json({ error: "Record not found" });
//     }

//     res.json({
//       message: "SQS Count marked complete ✅",
//       data: updated,
//     });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

// /** Get SQS queue statistics */
// app.get("/queue/stats", async (req, res) => {
//   try {
//     const stats = await getQueueStats();
//     const cachedMessage = getMessage();

//     res.json({
//       queue: {
//         ...stats,
//         total: stats.available + stats.inFlight + stats.delayed,
//       },
//       cached: cachedMessage
//         ? {
//             id: cachedMessage.id,
//             hasReceipt: !!cachedMessage.receipt,
//           }
//         : null,
//       diagnosis: {
//         hasMessages: stats.available + stats.inFlight + stats.delayed > 0,
//         canReceive: stats.available > 0,
//         stuck: stats.inFlight > 0 && stats.available === 0,
//         suggestion:
//           stats.inFlight > 0 && stats.available === 0
//             ? `${stats.inFlight} messages are in-flight. Wait ${stats.visibilityTimeout}s or purge queue.`
//             : stats.available > 0
//               ? "Messages available - try /fetch"
//               : "Queue is empty",
//       },
//     });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

// /** Reset deduplication tracking */
// app.post("/queue/reset-deduplication", (req, res) => {
//   resetDeduplication();
//   res.json({
//     ok: true,
//     message: "Deduplication tracking reset. Next message will not be skipped.",
//   });
// });

// app.listen(PORT, () => console.log("Server running", PORT));

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { connectDB } from "./db.js";
import Approval from "./models/Approval.js";
import TodayTotal from "./models/TodayTotal.js";

dotenv.config();
connectDB();

import {
  pollSQS,
  getMessage,
  approveMessage,
  deleteAllMessages,
  getQueueStats,
  resetDeduplication,
} from "./sqsWorker.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const APPROVALS_FILE = path.resolve(process.cwd(), "approvals.json");
const PLAYBACK_CONFIG_FILE = path.resolve(
  process.cwd(),
  "playback-config.json",
);

async function readApprovals() {
  try {
    const raw = await fs.readFile(APPROVALS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveApproval(obj) {
  const arr = await readApprovals();
  arr.push(obj);
  await fs.writeFile(APPROVALS_FILE, JSON.stringify(arr, null, 2));
}

async function readPlaybackConfig() {
  try {
    const raw = await fs.readFile(PLAYBACK_CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      forwardKey:
        typeof parsed.forwardKey === "string"
          ? parsed.forwardKey
          : "ArrowRight",
      backwardKey:
        typeof parsed.backwardKey === "string"
          ? parsed.backwardKey
          : "ArrowLeft",
      forwardSeconds: Number.isFinite(Number(parsed.forwardSeconds))
        ? Number(parsed.forwardSeconds)
        : 10,
      backwardSeconds: Number.isFinite(Number(parsed.backwardSeconds))
        ? Number(parsed.backwardSeconds)
        : 10,
    };
  } catch {
    return {
      forwardKey: "ArrowRight",
      backwardKey: "ArrowLeft",
      forwardSeconds: 10,
      backwardSeconds: 10,
    };
  }
}

async function savePlaybackConfig(config) {
  await fs.writeFile(PLAYBACK_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/** cached message */
app.get("/message", (req, res) => {
  res.json(getMessage());
});

/** fetch next */
app.post("/fetch", async (req, res) => {
  try {
    const existing = getMessage();
    if (existing) {
      console.log("✅ Returning cached message");
      return res.json(existing);
    }
    console.log("📡 No cached message, polling SQS...");
    const msg = await pollSQS();
    if (!msg) {
      console.log("📭 Queue is empty");
      return res.json({
        message: "No messages available in queue",
        empty: true,
      });
    }
    res.json(msg);
  } catch (e) {
    console.error("❌ /fetch error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

/** approve */
app.post("/approve", async (req, res) => {
  try {
    const { message, approvedValue } = req.body;
    if (!message?.receipt) {
      return res.status(400).json({ error: "No message provided" });
    }
    const parsed = message.body;
    try {
      await approveMessage(message.receipt);
    } catch (deleteError) {
      if (deleteError.message?.includes("expired")) {
        return res.status(410).json({
          error: "Message expired. Please fetch a new message.",
          expired: true,
        });
      }
      throw deleteError;
    }
    const record = await Approval.create({
      messageId: message.id,
      truck_number: parsed?.truck_number,
      original_count: Number(parsed?.count),
      approved_count: Number(approvedValue),
    });
    const next = await pollSQS();
    res.json({ ok: true, record, next });
  } catch (e) {
    console.error("❌ /approve error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.put("/approval/:id", async (req, res) => {
  try {
    const { approved_count } = req.body;
    const updated = await Approval.findByIdAndUpdate(
      req.params.id,
      { approved_count },
      { new: true },
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** approvals list */
app.get("/approvals", async (req, res) => {
  const list = await Approval.find().sort({ createdAt: -1 });
  res.json(list);
});

/** delete all messages */
app.post("/deleteAll", async (req, res) => {
  try {
    await deleteAllMessages();
    res.json({
      ok: true,
      message: "Queue purge requested (may take up to 60s)",
      queue: process.env.SQS_URL,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** changed the totals/today to totals/counts */
// app.get("/totals/today", async (req, res) => {
//   try {
//     const today = new Date().toISOString().split("T")[0];
//     const start = new Date(today);
//     start.setHours(0, 0, 0, 0);
//     const end = new Date(today);
//     end.setHours(23, 59, 59, 999);

//     const data = await Approval.aggregate([
//       { $match: { createdAt: { $gte: start, $lte: end } } },
//       {
//         $group: {
//           _id: "$truck_number",
//           totalApproved: { $sum: "$approved_count" },
//           entries: { $sum: 1 },
//         },
//       },
//       {
//         $project: {
//           truck_number: "$_id",
//           totalApproved: 1,
//           entries: 1,
//           _id: 0,
//         },
//       },
//     ]);

//     const results = [];
//     for (const item of data) {
//       const updated = await TodayTotal.findOneAndUpdate(
//         { truck_number: item.truck_number, date: today },
//         {
//           $set: { totalApproved: item.totalApproved, entries: item.entries },
//           $setOnInsert: { sqsCountComplete: false },
//         },
//         { new: true, upsert: true },
//       );
//       results.push(updated);
//     }

//     res.json({ message: "Today's totals synced successfully", data: results });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

app.get("/totals/counts", async (req, res) => {
  try {
    const data = await Approval.aggregate([
      {
        $group: {
          _id: "$truck_number",
          totalApproved: { $sum: "$approved_count" },
          entries: { $sum: 1 },
        },
      },
      {
        $project: {
          truck_number: "$_id",
          totalApproved: 1,
          entries: 1,
          _id: 0,
        },
      },
    ]);

    res.json({
      message: "Total counts fetched successfully",
      data,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// app.put("/totals/complete", async (req, res) => {
//   try {
//     const { date, truck_number } = req.body;
//     if (!date || !truck_number) {
//       return res.status(400).json({ error: "Date and truck_number required" });
//     }
//     const updated = await TodayTotal.findOneAndUpdate(
//       { truck_number, date },
//       { sqsCountComplete: true },
//       { new: true },
//     );
//     if (!updated) {
//       return res.status(404).json({ error: "Record not found" });
//     }
//     res.json({ message: "SQS Count marked complete ✅", data: updated });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

app.put("/totals/complete", async (req, res) => {
  try {
    const { date, truck_number } = req.body;

    if (!date || !truck_number) {
      return res.status(400).json({ error: "Date and truck_number required" });
    }

    const updated = await TodayTotal.findOneAndUpdate(
      {
        truck_number,
        date, // ✅ STRING match (IMPORTANT)
      },
      { sqsCountComplete: true },
      { new: true, upsert: true },
    );

    if (!updated) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({ message: "SQS Count marked complete ✅", data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** SQS queue stats */
app.get("/queue/stats", async (req, res) => {
  try {
    const stats = await getQueueStats();
    const cachedMessage = getMessage();
    res.json({
      queue: {
        ...stats,
        total: stats.available + stats.inFlight + stats.delayed,
      },
      cached: cachedMessage
        ? { id: cachedMessage.id, hasReceipt: !!cachedMessage.receipt }
        : null,
      diagnosis: {
        hasMessages: stats.available + stats.inFlight + stats.delayed > 0,
        canReceive: stats.available > 0,
        stuck: stats.inFlight > 0 && stats.available === 0,
        suggestion:
          stats.inFlight > 0 && stats.available === 0
            ? `${stats.inFlight} messages are in-flight. Wait ${stats.visibilityTimeout}s or purge queue.`
            : stats.available > 0
              ? "Messages available - try /fetch"
              : "Queue is empty",
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Reset deduplication */
app.post("/queue/reset-deduplication", (req, res) => {
  resetDeduplication();
  res.json({ ok: true, message: "Deduplication tracking reset." });
});

app.get("/playback/config", async (req, res) => {
  try {
    const config = await readPlaybackConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/playback/config", async (req, res) => {
  try {
    const {
      forwardKey = "ArrowRight",
      backwardKey = "ArrowLeft",
      forwardSeconds = 10,
      backwardSeconds = 10,
    } = req.body ?? {};

    const config = {
      forwardKey: String(forwardKey).trim() || "ArrowRight",
      backwardKey: String(backwardKey).trim() || "ArrowLeft",
      forwardSeconds: Math.max(1, Number(forwardSeconds) || 10),
      backwardSeconds: Math.max(1, Number(backwardSeconds) || 10),
    };

    await savePlaybackConfig(config);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// ROI ENDPOINTS
// ─────────────────────────────────────────────

/** GET /roi/frame — serves the saved camera snapshot */
app.get("/roi/frame", async (req, res) => {
  try {
    const framePath = path.resolve(process.cwd(), "rtsp-sample.jpg");
    await fs.access(framePath);
    res.sendFile(framePath, (err) => {
      if (err) res.status(500).json({ error: "Failed to send file" });
    });
  } catch {
    res.status(404).json({ error: "No frame available" });
  }
});

/** POST /roi/save — receives points from browser, saves as roi.npy via Python */
/** POST /roi/save — saves points as roi.npy using pure Node.js */
app.post("/roi/save", async (req, res) => {
  const { points } = req.body;

  if (!points || points.length < 3) {
    return res.status(400).json({ error: "At least 3 points required" });
  }

  try {
    const npy_path = path.resolve(process.cwd(), "roi.npy");

    // Build numpy .npy file format manually
    // NPY format: magic + version + header length + header + data
    const numPoints = points.length;
    const shape = [numPoints, 2];
    const dtype = "<f8"; // float64 little-endian

    const header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${shape[0]}, ${shape[1]}), }`;

    // Header must be padded to multiple of 64 bytes
    const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]); // \x93NUMPY
    const version = Buffer.from([0x01, 0x00]); // version 1.0

    // Pad header with spaces so total prefix is multiple of 64
    const prefixLen = magic.length + version.length + 2; // +2 for header_len bytes
    const headerPadded =
      header.padEnd(
        Math.ceil((prefixLen + header.length + 1) / 64) * 64 - prefixLen,
        " ",
      ) + "\n";

    const headerLenBuf = Buffer.alloc(2);
    headerLenBuf.writeUInt16LE(headerPadded.length, 0);

    // Write float64 data (x, y pairs)
    const dataBuf = Buffer.alloc(numPoints * 2 * 8);
    points.forEach((p, i) => {
      dataBuf.writeDoubleBE(p.x, i * 16); // ← won't work for LE
      dataBuf.writeDoubleBE(p.y, i * 16 + 8);
    });

    // Use writeDoubleLE for little-endian float64
    const dataLE = Buffer.alloc(numPoints * 2 * 8);
    points.forEach((p, i) => {
      dataLE.writeDoubleLE(p.x, i * 16);
      dataLE.writeDoubleLE(p.y, i * 16 + 8);
    });

    const npy = Buffer.concat([
      magic,
      version,
      headerLenBuf,
      Buffer.from(headerPadded),
      dataLE,
    ]);

    await fs.writeFile(npy_path, npy);

    // Also save as JSON as backup (easier to read back)
    const jsonPath = path.resolve(process.cwd(), "roi.json");
    await fs.writeFile(jsonPath, JSON.stringify(points, null, 2));

    console.log("✅ ROI saved:", npy_path);
    res.json({ ok: true, pointCount: points.length });
  } catch (e) {
    console.error("❌ ROI save error:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});
/** GET /roi/status */
/** GET /roi/status */
app.get("/roi/status", async (req, res) => {
  try {
    await fs.access(path.resolve(process.cwd(), "roi.npy"));
    try {
      const jsonPath = path.resolve(process.cwd(), "roi.json");
      const raw = await fs.readFile(jsonPath, "utf-8");
      const points = JSON.parse(raw);
      res.json({ exists: true, points });
    } catch {
      res.json({ exists: true, points: [] });
    }
  } catch {
    res.json({ exists: false, points: [] });
  }
});

app.listen(PORT, () => console.log("Server running", PORT));
