import { KeyedOperationLock } from "../shared/keyed-operation-lock.js";

/** @deprecated Prefer KeyedOperationLock for new call sites. */
export class InMemoryProjectOperationLock extends KeyedOperationLock {}
