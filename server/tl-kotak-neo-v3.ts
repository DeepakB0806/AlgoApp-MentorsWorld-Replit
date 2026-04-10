// ═══════════════════════════════════════════════════════════════════════════════
// IMPORTS & CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
import { db } from "./db";
import { broker_field_mappings, universal_fields } from "@shared/schema";
import { eq } from "drizzle-orm";

// ⚠️ SPECIAL INSTRUCTION: NO AI OR DEVELOPER IS PERMITTED TO UNLOCK, MODIFY, OR TAMPER WITH ANY 🔒 LOCKED BLOCK WITHOUT EXPLICIT, PRIOR AUTHORIZATION FROM THE USER.
// ⚠️ CODING RULE: Any task that requires modifying a 🔒 LOCKED BLOCK MUST (a) explicitly name the locked block in the task description, and (b) obtain the user's written permission before the block is opened. No exceptions.
//
// 📋 TL PERMANENT INVARIANTS — rules established through production incidents; never reverse without user sign-off:
//   [TL-1] buildMaps collision policy is last-entry-wins. Count is logged but never throws.
//   [TL-2] translateRequest resolves via requestMap keyed by {category}::{universalName}. Never fall through on partial matches.
//   [TL-3] buildRequestPayload injects DB default values when includeDefaults=true — defaults from DB, never hard-coded.

const BROKER_NAME = "kotak_neo_v3";
const LOG_PREFIX = "[TL]";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════
interface BrokerFieldEntry {
  id: number;
  fieldCode: string;
  fieldName: string;
  universalFieldName: string | null;
  category: string;
  direction: string;
  fieldType: string;
  fieldDescription: string | null;
  allowedValues: string | null;
  defaultValue: string | null;
  isRequired: boolean | null;
  endpoint: string | null;
  notes: string | null;
}

interface UniversalFieldEntry {
  id: number;
  fieldName: string;
  displayName: string;
  category: string;
  dataType: string;
  description: string | null;
}

interface TranslationResult {
  payload: Record<string, any>;
  mapped: string[];
  unmapped: string[];
}

interface TLStatus {
  isReady: boolean;
  brokerName: string;
  brokerFieldCount: number;
  universalFieldCount: number;
  categories: string[];
  directions: string[];
  lastLoadTime: string | null;
  lastLoadDurationMs: number | null;
  matchedCount: number;
  unmatchedCount: number;
  initError: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSLATION LAYER CLASS
// ═══════════════════════════════════════════════════════════════════════════════
class TranslationLayer {
  // ─── Class Properties ──────────────────────────────────────────────────────
  private brokerFields: BrokerFieldEntry[] = [];
  private universalFieldList: UniversalFieldEntry[] = [];

  private requestMap: Map<string, BrokerFieldEntry> = new Map();
  private responseMap: Map<string, BrokerFieldEntry> = new Map();

  private categoryIndex: Map<string, BrokerFieldEntry[]> = new Map();
  private directionIndex: Map<string, BrokerFieldEntry[]> = new Map();
  private categoryDirectionIndex: Map<string, BrokerFieldEntry[]> = new Map();

  private universalFieldMap: Map<string, UniversalFieldEntry> = new Map();

  private ready = false;
  private lastLoadTime: string | null = null;
  private lastLoadDurationMs: number | null = null;
  private initError: string | null = null;
  private reloading = false;

  // ─── Init & Load ─────────────────────────────────────────────────────────
  async init(): Promise<void> {
    const start = Date.now();
    console.log(`${LOG_PREFIX} Initializing Translation Layer for ${BROKER_NAME}...`);

    try {
      const rawBrokerFields = await db
        .select()
        .from(broker_field_mappings)
        .where(eq(broker_field_mappings.brokerName, BROKER_NAME));

      if (rawBrokerFields.length === 0) {
        this.ready = false;
        this.initError = `No broker field mappings found for ${BROKER_NAME}`;
        console.error(`${LOG_PREFIX} FAIL: ${this.initError}`);
        return;
      }

      this.brokerFields = rawBrokerFields.map((r) => ({
        id: r.id,
        fieldCode: r.fieldCode,
        fieldName: r.fieldName,
        universalFieldName: r.universalFieldName,
        category: r.category,
        direction: r.direction,
        fieldType: r.fieldType,
        fieldDescription: r.fieldDescription,
        allowedValues: r.allowedValues,
        defaultValue: r.defaultValue,
        isRequired: r.isRequired,
        endpoint: r.endpoint,
        notes: r.notes,
      }));

      const rawUniversalFields = await db.select().from(universal_fields);

      if (rawUniversalFields.length === 0) {
        this.ready = false;
        this.initError = "No universal fields found in database";
        console.error(`${LOG_PREFIX} FAIL: ${this.initError}`);
        return;
      }

      this.universalFieldList = rawUniversalFields.map((r) => ({
        id: r.id,
        fieldName: r.fieldName,
        displayName: r.displayName,
        category: r.category,
        dataType: r.dataType,
        description: r.description,
      }));

      this.buildMaps();

      const elapsed = Date.now() - start;
      this.lastLoadTime = new Date().toISOString();
      this.lastLoadDurationMs = elapsed;
      this.initError = null;
      this.ready = true;

      const matched = this.brokerFields.filter((f) => f.universalFieldName).length;
      const categories = [...this.categoryIndex.keys()];

      console.log(
        `${LOG_PREFIX} Ready — ${this.brokerFields.length} broker fields, ${this.universalFieldList.length} universal fields, ${matched} matched, ${categories.length} categories [${categories.join(", ")}] loaded in ${elapsed}ms`,
      );
    } catch (error: any) {
      this.ready = false;
      this.initError = error.message;
      console.error(`${LOG_PREFIX} Init failed: ${error.message}`);
    }
  }

  // 🔒 LOCKED BLOCK START — TL buildMaps: last-entry-wins collision policy; collisions logged, never thrown [TL-1]
  // ─── Map Building ───────────────────────────────────────────────────────
  private buildMaps(): void {
    this.requestMap.clear();
    this.responseMap.clear();
    this.categoryIndex.clear();
    this.directionIndex.clear();
    this.categoryDirectionIndex.clear();
    this.universalFieldMap.clear();

    for (const uf of this.universalFieldList) {
      this.universalFieldMap.set(uf.fieldName, uf);
    }

    let collisions = 0;

    for (const field of this.brokerFields) {
      if (field.universalFieldName) {
        if (field.direction === "request") {
          const uKey = `${field.category}::${field.universalFieldName}`;
          if (this.requestMap.has(uKey)) {
            collisions++;
            console.warn(`${LOG_PREFIX} Request map collision: ${uKey} (fieldCode=${field.fieldCode}, endpoint=${field.endpoint})`);
          }
          this.requestMap.set(uKey, field);

          const bKey = `${field.category}::${field.fieldCode}`;
          this.responseMap.set(bKey, field);
        } else {
          const bKey = `${field.category}::${field.fieldCode}`;
          if (this.responseMap.has(bKey)) {
            collisions++;
            console.warn(`${LOG_PREFIX} Response map collision: ${bKey} (universalFieldName=${field.universalFieldName})`);
          }
          this.responseMap.set(bKey, field);
        }
      }

      if (!this.categoryIndex.has(field.category)) {
        this.categoryIndex.set(field.category, []);
      }
      this.categoryIndex.get(field.category)!.push(field);

      if (!this.directionIndex.has(field.direction)) {
        this.directionIndex.set(field.direction, []);
      }
      this.directionIndex.get(field.direction)!.push(field);

      const cdKey = `${field.category}::${field.direction}`;
      if (!this.categoryDirectionIndex.has(cdKey)) {
        this.categoryDirectionIndex.set(cdKey, []);
      }
      this.categoryDirectionIndex.get(cdKey)!.push(field);
    }

    if (collisions > 0) {
      console.warn(`${LOG_PREFIX} ${collisions} map collisions detected — last entry wins`);
    }
  }
  // 🔒 LOCKED BLOCK END

  // ─── Reload ─────────────────────────────────────────────────────────────
  async reload(): Promise<void> {
    if (this.reloading) {
      console.warn(`${LOG_PREFIX} Reload already in progress, skipping`);
      return;
    }
    this.reloading = true;
    try {
      console.log(`${LOG_PREFIX} Reloading mappings from database...`);
      await this.init();
    } finally {
      this.reloading = false;
    }
  }

  // ─── Status & Diagnostics ────────────────────────────────────────────────
  isReady(): boolean {
    return this.ready;
  }

  getStatus(): TLStatus {
    const matched = this.brokerFields.filter((f) => f.universalFieldName).length;
    return {
      isReady: this.ready,
      brokerName: BROKER_NAME,
      brokerFieldCount: this.brokerFields.length,
      universalFieldCount: this.universalFieldList.length,
      categories: [...this.categoryIndex.keys()],
      directions: [...this.directionIndex.keys()],
      lastLoadTime: this.lastLoadTime,
      lastLoadDurationMs: this.lastLoadDurationMs,
      matchedCount: matched,
      unmatchedCount: this.brokerFields.length - matched,
      initError: this.initError,
    };
  }

  // 🔒 LOCKED BLOCK START — TL translateRequest: resolves via requestMap keyed by {category}::{universalName}; never fall through on partial matches [TL-2]
  // ─── Request Translation (Universal → Broker) ───────────────────────────
  translateRequest(
    category: string,
    universalPayload: Record<string, any>,
  ): TranslationResult {
    if (!this.ready) {
      console.warn(`${LOG_PREFIX} translateRequest called but TL is not ready`);
      return { payload: {}, mapped: [], unmapped: Object.keys(universalPayload) };
    }

    const payload: Record<string, any> = {};
    const mapped: string[] = [];
    const unmapped: string[] = [];

    for (const [universalName, value] of Object.entries(universalPayload)) {
      const key = `${category}::${universalName}`;
      const field = this.requestMap.get(key);

      if (field) {
        payload[field.fieldCode] = this.castValue(value, field.fieldType);
        mapped.push(universalName);
      } else {
        unmapped.push(universalName);
      }
    }

    if (unmapped.length > 0) {
      console.warn(
        `${LOG_PREFIX} translateRequest(${category}): ${unmapped.length} unmapped fields: [${unmapped.join(", ")}]`,
      );
    }

    return { payload, mapped, unmapped };
  }
  // 🔒 LOCKED BLOCK END

  // ─── Response Translation (Broker → Universal) ──────────────────────────
  translateResponse(
    category: string,
    brokerPayload: Record<string, any>,
  ): TranslationResult {
    if (!this.ready) {
      console.warn(`${LOG_PREFIX} translateResponse called but TL is not ready`);
      return { payload: {}, mapped: [], unmapped: Object.keys(brokerPayload) };
    }

    const payload: Record<string, any> = {};
    const mapped: string[] = [];
    const unmapped: string[] = [];

    for (const [brokerCode, value] of Object.entries(brokerPayload)) {
      const key = `${category}::${brokerCode}`;
      const field = this.responseMap.get(key);

      if (field && field.universalFieldName) {
        payload[field.universalFieldName] = value;
        mapped.push(brokerCode);
      } else {
        payload[brokerCode] = value;
        unmapped.push(brokerCode);
      }
    }

    return { payload, mapped, unmapped };
  }

  // ─── Field Lookup Helpers ────────────────────────────────────────────────
  getBrokerField(
    universalFieldName: string,
    category: string,
  ): BrokerFieldEntry | null {
    if (!this.ready) return null;
    const key = `${category}::${universalFieldName}`;
    return this.requestMap.get(key) || null;
  }

  getBrokerFieldCode(
    universalFieldName: string,
    category: string,
  ): string | null {
    const field = this.getBrokerField(universalFieldName, category);
    return field ? field.fieldCode : null;
  }

  getUniversalField(
    brokerFieldCode: string,
    category: string,
  ): BrokerFieldEntry | null {
    if (!this.ready) return null;
    const key = `${category}::${brokerFieldCode}`;
    return this.responseMap.get(key) || null;
  }

  getUniversalFieldName(
    brokerFieldCode: string,
    category: string,
  ): string | null {
    const field = this.getUniversalField(brokerFieldCode, category);
    return field ? field.universalFieldName : null;
  }

  getFieldsByCategory(category: string): BrokerFieldEntry[] {
    if (!this.ready) return [];
    return this.categoryIndex.get(category) || [];
  }

  getFieldsByDirection(direction: string): BrokerFieldEntry[] {
    if (!this.ready) return [];
    return this.directionIndex.get(direction) || [];
  }

  getFieldsByCategoryAndDirection(
    category: string,
    direction: string,
  ): BrokerFieldEntry[] {
    if (!this.ready) return [];
    return this.categoryDirectionIndex.get(`${category}::${direction}`) || [];
  }

  getCategories(): string[] {
    return [...this.categoryIndex.keys()];
  }

  getAllowedValues(fieldCode: string, category: string): string | null {
    const field = this.responseMap.get(`${category}::${fieldCode}`) || this.requestMap.get(`${category}::${fieldCode}`);
    return field ? field.allowedValues : null;
  }

  getDefaultValue(fieldCode: string, category: string): string | null {
    const field = this.responseMap.get(`${category}::${fieldCode}`) || this.requestMap.get(`${category}::${fieldCode}`);
    return field ? field.defaultValue : null;
  }

  getAllowedValuesByUniversalName(universalName: string, category: string): string | null {
    if (!this.ready) return null;
    const fields = this.getRequestFields(category);
    const field = fields.find(f => f.universalFieldName === universalName);
    return field ? field.allowedValues : null;
  }

  mapValueFromAllowed(universalName: string, category: string, inputValue: string): string | null {
    const allowed = this.getAllowedValuesByUniversalName(universalName, category);
    if (!allowed) return null;
    const pairs = allowed.split(",");
    for (const pair of pairs) {
      const [brokerVal, displayVal] = pair.split("=");
      if (displayVal === inputValue) return brokerVal;
      if (brokerVal === inputValue) return brokerVal;
    }
    return null;
  }

  getDefaultByUniversalName(universalName: string, category: string): string | null {
    if (!this.ready) return null;
    const fields = this.getRequestFields(category);
    const field = fields.find(f => f.universalFieldName === universalName);
    return field ? field.defaultValue : null;
  }

  getUniversalFieldMetadata(fieldName: string): UniversalFieldEntry | null {
    return this.universalFieldMap.get(fieldName) || null;
  }

  getRequestFields(category: string): BrokerFieldEntry[] {
    return this.getFieldsByCategoryAndDirection(category, "request");
  }

  getResponseFields(category: string): BrokerFieldEntry[] {
    return this.getFieldsByCategoryAndDirection(category, "response");
  }

  // 🔒 LOCKED BLOCK START — TL buildRequestPayload: DB default values injected when includeDefaults=true; defaults from DB only, never hard-coded [TL-3]
  // ─── Payload Builders (with defaults) ────────────────────────────────────
  buildRequestPayload(
    category: string,
    universalPayload: Record<string, any>,
    includeDefaults: boolean = false,
  ): TranslationResult {
    if (!this.ready) {
      console.warn(`${LOG_PREFIX} buildRequestPayload called but TL is not ready`);
      return { payload: {}, mapped: [], unmapped: Object.keys(universalPayload) };
    }

    const result = this.translateRequest(category, universalPayload);

    if (includeDefaults) {
      const requestFields = this.getRequestFields(category);
      for (const field of requestFields) {
        if (!(field.fieldCode in result.payload) && field.defaultValue !== null) {
          result.payload[field.fieldCode] = this.castValue(field.defaultValue, field.fieldType);
        }
      }
    }

    return result;
  }
  // 🔒 LOCKED BLOCK END

  parseResponsePayload(
    category: string,
    brokerPayload: Record<string, any>,
  ): TranslationResult {
    return this.translateResponse(category, brokerPayload);
  }

  // ─── Value Casting ──────────────────────────────────────────────────────
  private castValue(value: any, fieldType: string): any {
    if (value === null || value === undefined) return value;

    switch (fieldType) {
      case "number":
        const num = Number(value);
        return isNaN(num) ? value : num;
      case "boolean":
        if (typeof value === "string") {
          return value.toLowerCase() === "true" || value === "1";
        }
        return Boolean(value);
      case "string":
        return String(value);
      default:
        return value;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
const TL = new TranslationLayer();

export default TL;
export { TranslationLayer };
export type { BrokerFieldEntry, UniversalFieldEntry, TLStatus, TranslationResult };
