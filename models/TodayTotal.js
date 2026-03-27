import mongoose from "mongoose";

const todayTotalSchema = new mongoose.Schema(
  {
    truck_number: {
      type: String,
      required: true,
    },
    totalApproved: {
      type: Number,
      required: true,
    },
    entries: {
      type: Number,
      required: true,
    },
    date: {
      type: String, // 🔥 store as YYYY-MM-DD
      required: true,
    },
    sqsCountComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// prevent duplicate truck per day
todayTotalSchema.index({ truck_number: 1, date: 1 }, { unique: true });

export default mongoose.model("TodayTotal", todayTotalSchema);
