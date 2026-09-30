export type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
/** Freeze detached, validated snapshot values; callers must not pass cyclic graphs. */
export function deepFreeze<T>(value:T):DeepReadonly<T>{
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}
 return value as DeepReadonly<T>;
}
