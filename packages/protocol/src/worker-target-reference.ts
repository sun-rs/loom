import { z } from "zod";

// Leaf schemas shared by target-aware facades without importing Room projections.
export const WorkerTargetReceiptSchema = z.string().min(1).max(4096);
export const WorkerReadChannelSchema = z.string().trim().min(1).max(500);
