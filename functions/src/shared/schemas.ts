/**
 * Zod Validation Schemas
 */

import { z } from 'zod';

export const PhoneSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid E.164 phone number format');

export const SubmitDoctorProfileSchema = z.object({
  fullName: z.string().min(2).max(100),
  council: z.string().min(2).max(100),
  registrationNo: z.string().min(2).max(50),
  qualification: z.string().min(2).max(100),
  specialties: z.array(z.string()).min(1),
  primarySpecialty: z.string().min(2),
  yearsOfExperience: z.number().int().min(0).max(70),
  preferredCities: z.array(z.string()).min(1),
  bio: z.string().max(1000).optional(),
});

export const CreateOrganizationSchema = z.object({
  legalName: z.string().min(2).max(150),
  displayName: z.string().min(2).max(150),
  organizationType: z.enum(['hospital', 'clinic', 'nursing_home']),
  registrationNumber: z.string().min(2).max(100),
  address: z.string().min(5).max(300),
  city: z.string().min(2).max(100),
});

export const CreateFacilitySchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(2).max(150),
  address: z.string().min(5).max(300),
  city: z.string().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const CreateDutySchema = z.object({
  organizationId: z.string().min(1),
  facilityId: z.string().min(1),
  facilityName: z.string().min(1),
  city: z.string().min(1),
  department: z.string().min(2).max(100),
  specialtyId: z.string().min(1),
  specialtyName: z.string().min(1),
  qualificationRequired: z.string().min(2),
  experienceMinYears: z.number().int().min(0),
  schedule: z.object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    shiftType: z.enum(['morning', 'evening', 'night', 'full_day']),
  }),
  headcount: z.number().int().min(1).max(50),
  paymentTerms: z.object({
    amount: z.number().positive(),
    currency: z.string().default('INR'),
    basis: z.enum(['per_shift', 'per_hour']),
    expectedPaymentTiming: z.enum(['end_of_shift', 'within_24_hours', 'weekly']),
  }),
  notes: z.string().max(1000).optional(),
});

export const ApplyToDutySchema = z.object({
  dutyId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const AtomicSelectDoctorSchema = z.object({
  dutyId: z.string().min(1),
  doctorId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const ConfirmAssignmentSchema = z.object({
  assignmentId: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

export const VerificationDecisionSchema = z.object({
  caseId: z.string().min(1),
  decision: z.enum(['approved', 'needs_information', 'rejected']),
  reasonCode: z.string().min(2),
  notes: z.string().max(1000).optional(),
});

export const OfficialSourceReviewSchema = z.object({
  sourceUrl: z.string().url().max(2048).refine(value => value.startsWith('https://')),
  checkedAt: z.string().datetime(),
  registrationNumberMatched: z.literal(true),
  nameMatched: z.literal(true),
  councilMatched: z.literal(true),
  qualificationMatched: z.literal(true),
  officialStatus: z.literal('ACTIVE'),
}).strict();

export const ModerationActionSchema = z.object({
  reportId: z.string().min(1),
  action: z.enum(['hide_duty', 'warn_user', 'suspend_user', 'dismiss']),
  reasonCode: z.string().min(2),
  notes: z.string().max(1000).optional(),
});
