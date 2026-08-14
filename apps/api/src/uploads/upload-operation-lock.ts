import { KeyedOperationLock } from "../shared/keyed-operation-lock.js";

/**
 * Compatibility name for upload call sites. New bounded contexts can depend
 * on KeyedOperationLock directly.
 */
export class UploadOperationLock extends KeyedOperationLock {}
