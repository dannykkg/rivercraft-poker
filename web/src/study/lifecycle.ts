type LeaveGuard = () => Promise<void>;
const guards = new Set<LeaveGuard>();
/** Components register only while mounted; navigation awaits their in-flight writes. */
export const registerLeaveGuard = (guard: LeaveGuard): (() => void) => {
  guards.add(guard); return () => { guards.delete(guard); };
};
export const flushStudyNavigation = async (): Promise<void> => {
  for (const guard of [...guards]) await guard();
};
