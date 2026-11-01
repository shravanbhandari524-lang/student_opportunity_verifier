import { z } from "zod";
import { RECIPIENT_TYPES, PAYMENT_METHODS, LANGUAGES } from "./enums.js";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates that an ISO date string (YYYY-MM-DD) is:
 * 1. A syntactically valid calendar date
 * 2. Not in the future (relative to now)
 * 3. Not older than 365 days in the past
 *
 * @param {string} val
 * @returns {boolean}
 */
export function isValidFraudDate(val) {
  if (typeof val !== "string" || !ISO_DATE_REGEX.test(val)) return false;
  const parts = val.split("-").map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    d.getUTCFullYear() !== parts[0] ||
    d.getUTCMonth() !== parts[1] - 1 ||
    d.getUTCDate() !== parts[2]
  ) {
    return false;
  }
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dateUtc = d.getTime();

  // Not in the future
  if (dateUtc > todayUtc) return false;

  // Not older than 365 days
  const minUtc = todayUtc - 365 * 24 * 60 * 60 * 1000;
  if (dateUtc < minUtc) return false;

  return true;
}

export const CollegeEmailRequestSchema = z
  .object({
    recipientType: z.enum(RECIPIENT_TYPES, {
      errorMap: () => ({ message: "recipientType must be one of: placement_cell, dean_student_welfare, department_head, grievance_officer" }),
    }),
    language: z.enum(LANGUAGES).default("en"),
  })
  .strict();

export const CollegeEmailResponseSchema = z
  .object({
    subject: z.string().min(1).max(200).refine((s) => !/[\r\n]/.test(s), {
      message: "subject must not contain newline characters",
    }),
    body: z.string().min(1).max(10000),
    recipientRole: z.string().min(1).max(200),
    notes: z.array(z.string()).optional(),
  })
  .strict();

export const FraudSummaryRequestSchema = z
  .object({
    amount: z
      .number()
      .int("amount must be an integer")
      .min(1, "amount must be at least 1")
      .max(10000000, "amount must not exceed 10,000,000")
      .optional(),
    date: z
      .string()
      .refine(isValidFraudDate, {
        message: "date must be a valid YYYY-MM-DD date not in the future and within the past 365 days",
      })
      .optional(),
    paymentMethod: z.enum(PAYMENT_METHODS, {
      errorMap: () => ({ message: "paymentMethod must be one of: upi, netbanking, card, wallet, cash, other" }),
    }).optional(),
    language: z.enum(LANGUAGES).default("en"),
  })
  .strict();

export const ReportingChannelSchema = z
  .object({
    name: z.string().min(1),
    url: z.string().url().nullable(),
    helpline: z.string().nullable(),
    verified: z.boolean(),
    text: z.string().min(1),
  })
  .strict();

export const FraudSummaryResponseSchema = z
  .object({
    title: z.string().min(1).max(200),
    narrative: z.string().min(1).max(10000),
    victimSteps: z.array(z.string().min(1).max(500)).min(1),
    reportingChannels: z.array(ReportingChannelSchema).default([]),
    notes: z.array(z.string()).optional(),
  })
  .strict();
