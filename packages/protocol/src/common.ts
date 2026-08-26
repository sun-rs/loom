import { z } from "zod";

export const IdentifierSchema = z.string().min(1);
export const TimestampSchema = z.iso.datetime({ offset: true });
