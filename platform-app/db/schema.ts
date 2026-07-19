import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const symptomObservations = sqliteTable("symptom_observations", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  ageBand: text("age_band").notNull(),
  bmiBand: text("bmi_band").notNull(),
  fatigue: text("fatigue"),
  weightChange: text("weight_change"),
  periodPattern: text("period_pattern"),
  periodPain: text("period_pain"),
  pain: text("pain"),
  skinChanges: text("skin_changes"),
  hairChanges: text("hair_changes"),
  sleepQuality: text("sleep_quality"),
  legacySkinHair: text("skin_hair"),
  modelVersion: text("model_version").notNull(),
});

export const researchCache = sqliteTable("research_cache", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const dailyCheckins = sqliteTable("daily_checkins", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().default("legacy_unknown"),
  entryDate: text("entry_date").notNull(),
  createdAt: integer("created_at").notNull(),
  cycleDay: integer("cycle_day"),
  mood: integer("mood").notNull(),
  energy: integer("energy").notNull(),
  bloating: integer("bloating").notNull(),
  pain: integer("pain").notNull(),
  sleep: integer("sleep").notNull(),
  periodStart: integer("period_start", { mode: "boolean" }).notNull(),
  bleeding: text("bleeding").notNull().default("none"),
  symptomSigns: text("symptom_signs").notNull().default("[]"),
  hormoneMedication: text("hormone_medication").notNull().default("prefer_not_to_say"),
  hotFlashes: integer("hot_flashes"),
  skinChanges: integer("skin_changes"),
  hairChanges: integer("hair_changes"),
  dataConfidence: text("data_confidence").notNull().default("typical_variation"),
  qualityFlags: text("quality_flags").notNull().default("[]"),
  modelVersion: text("model_version").notNull(),
});
