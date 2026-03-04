// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
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
} from "./sqsWorker.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const APPROVALS_FILE = path.resolve(process.cwd(), "approvals.json");

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

/** cached message */
app.get("/message", (req, res) => {
  res.json(getMessage());
});

/** fetch next */
app.post("/fetch", async (req, res) => {
  try {
    const existing = getMessage();
    if (existing) return res.json(existing);

    const msg = await pollSQS();
    res.json(msg);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** approve */
// app.post("/approve", async (req, res) => {
//   try {
//     const { approver, message } = req.body;

//     if (!message?.receipt) {
//       return res.status(400).json({ error: "No message provided" });
//     }

//     await approveMessage(message.receipt);

//     const record = {
//       messageId: message.id,
//       body: message.body,
//       approver: approver || "unknown",
//       approvedAt: new Date().toISOString(),
//     };

//     await saveApproval(record);

//     const next = await pollSQS();

//     res.json({
//       ok: true,
//       approved: record,
//       next,
//     });
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });
app.post("/approve", async (req, res) => {
  try {
    const { message, approvedValue } = req.body;

    if (!message?.receipt) return res.status(400).json({ error: "No message" });

    const parsed = message.body;

    await approveMessage(message.receipt);

    const record = await Approval.create({
      messageId: message.id,
      truck_number: parsed?.truck_number,
      original_count: Number(parsed?.count),
      approved_count: Number(approvedValue),
    });

    // Only poll for next if approveMessage didn't already re-fetch (latestMessage is null)
    const next = getMessage() ?? await pollSQS();

    res.json({ ok: true, record, next });
  } catch (e) {
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
// app.get("/approvals", async (req, res) => {
//   res.json(await readApprovals());
// });
app.get("/approvals", async (req, res) => {
  const list = await Approval.find().sort({ createdAt: -1 });
  res.json(list);
});

/** delete all messages */
app.post("/deleteAll", async (req, res) => {
  try {
    await deleteAllMessages(); // this now uses PurgeQueueCommand

    res.json({
      ok: true,
      message: "Queue purge requested (may take up to 60s)", // ⭐ important note
      queue: process.env.SQS_URL,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** total count  */
// app.get("/totals/today", async (req, res) => {
//   try {
//     const start = new Date();
//     start.setHours(0, 0, 0, 0);

//     const end = new Date();
//     end.setHours(23, 59, 59, 999);

//     const data = await Approval.aggregate([
//       {
//         $match: {
//           createdAt: { $gte: start, $lte: end },
//         },
//       },
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
//       { $sort: { totalApproved: -1 } },
//     ]);

//     res.json(data);
//   } catch (e) {
//     res.status(500).json({ error: e.message });
//   }
// });

app.get("/totals/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const start = new Date(today);
    start.setHours(0, 0, 0, 0);

    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const data = await Approval.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
        },
      },
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

    const results = [];

    for (const item of data) {
      const updated = await TodayTotal.findOneAndUpdate(
        {
          truck_number: item.truck_number,
          date: today,
        },
        {
          $set: {
            totalApproved: item.totalApproved,
            entries: item.entries,
          },
          $setOnInsert: {
            sqsCountComplete: false, // only when first created
          },
        },
        {
          new: true,
          upsert: true, // 🔥 KEY FIX
        },
      );

      results.push(updated);
    }

    res.json({
      message: "Today's totals synced successfully",
      data: results,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/totals/complete", async (req, res) => {
  try {
    const { date, truck_number } = req.body;

    if (!date || !truck_number) {
      return res.status(400).json({ error: "Date and truck_number required" });
    }

    const updated = await TodayTotal.findOneAndUpdate(
      {
        truck_number,
        date, // exact match string
      },
      { sqsCountComplete: true },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({
      message: "SQS Count marked complete ✅",
      data: updated,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log("Server running", PORT));
