/**
 * groupLeaveRequests.ts - UI-only utility for grouping consecutive leave requests
 * 
 * Groups requests by:
 * - Same user_id
 * - Same leave_type (absence/cp)
 * - Similar reason (or "Motif mixte" if different non-empty reasons)
 * - Consecutive dates (d(i+1) = d(i) + 1)
 * 
 * This is a pure presentation layer utility - no backend changes.
 */

export interface LeaveRequestInput {
  id: string;
  user_id: string;
  leave_date: string;
  leave_type: "absence" | "cp";
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  user_name?: string;
}

export interface RequestGroup {
  userId: string;
  userName: string;
  leaveType: "absence" | "cp";
  dateStart: string;
  dateEnd: string;
  dayCount: number;
  requestIds: string[];
  dates: string[];
  reasonLabel: string;
  status: "pending" | "approved" | "rejected";
}

export interface UserRequestGroups {
  userId: string;
  userName: string;
  groups: RequestGroup[];
  totalRequests: number;
}

/**
 * Check if two dates are consecutive (d2 = d1 + 1 day)
 */
function isConsecutive(date1: string, date2: string): boolean {
  const d1 = new Date(date1 + "T12:00:00Z");
  const d2 = new Date(date2 + "T12:00:00Z");
  const diffMs = d2.getTime() - d1.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.abs(diffDays - 1) < 0.01;
}

/**
 * Normalize reason for grouping purposes
 * Empty/null reasons are treated as equivalent
 */
function normalizeReason(reason: string | null): string {
  if (!reason || reason.trim() === "") return "";
  return reason.trim();
}

/**
 * Group consecutive leave requests
 * 
 * Rules:
 * - Same user_id
 * - Same leave_type
 * - Consecutive dates
 * - Compatible reasons (both empty, or same non-empty reason)
 *   → If reasons differ, we split into separate groups
 */
export function groupConsecutiveLeaveRequests(
  requests: LeaveRequestInput[]
): RequestGroup[] {
  if (requests.length === 0) return [];

  // Sort by user, type, date
  const sorted = [...requests].sort((a, b) => {
    if (a.user_id !== b.user_id) return a.user_id.localeCompare(b.user_id);
    if (a.leave_type !== b.leave_type) return a.leave_type.localeCompare(b.leave_type);
    return a.leave_date.localeCompare(b.leave_date);
  });

  const groups: RequestGroup[] = [];
  let currentGroup: RequestGroup | null = null;

  for (const req of sorted) {
    const normalizedReason = normalizeReason(req.reason);
    
    const canMerge =
      currentGroup &&
      currentGroup.userId === req.user_id &&
      currentGroup.leaveType === req.leave_type &&
      currentGroup.status === req.status &&
      isConsecutive(currentGroup.dates[currentGroup.dates.length - 1], req.leave_date) &&
      // Reason compatibility: both empty OR same non-empty
      (normalizeReason(currentGroup.reasonLabel === "Motif mixte" ? "" : currentGroup.reasonLabel) === normalizedReason ||
       normalizedReason === "" ||
       normalizeReason(currentGroup.reasonLabel) === "");

    if (canMerge && currentGroup) {
      // Extend current group
      currentGroup.dates.push(req.leave_date);
      currentGroup.requestIds.push(req.id);
      currentGroup.dateEnd = req.leave_date;
      currentGroup.dayCount = currentGroup.dates.length;
      
      // Update reason label if needed
      const existingReason = normalizeReason(currentGroup.reasonLabel === "Motif mixte" ? "" : currentGroup.reasonLabel);
      if (existingReason !== "" && normalizedReason !== "" && existingReason !== normalizedReason) {
        currentGroup.reasonLabel = "Motif mixte";
      } else if (existingReason === "" && normalizedReason !== "") {
        currentGroup.reasonLabel = req.reason!;
      }
    } else {
      // Save current group and start new one
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        userId: req.user_id,
        userName: req.user_name || "Inconnu",
        leaveType: req.leave_type,
        dateStart: req.leave_date,
        dateEnd: req.leave_date,
        dayCount: 1,
        requestIds: [req.id],
        dates: [req.leave_date],
        reasonLabel: req.reason || "",
        status: req.status,
      };
    }
  }

  // Don't forget the last group
  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Group requests by user, then by consecutive dates within each user
 */
export function groupRequestsByUserAndDates(
  requests: LeaveRequestInput[]
): UserRequestGroups[] {
  // First get all consecutive groups
  const allGroups = groupConsecutiveLeaveRequests(requests);

  // Then organize by user
  const userMap = new Map<string, UserRequestGroups>();

  for (const group of allGroups) {
    if (!userMap.has(group.userId)) {
      userMap.set(group.userId, {
        userId: group.userId,
        userName: group.userName,
        groups: [],
        totalRequests: 0,
      });
    }
    const userGroups = userMap.get(group.userId)!;
    userGroups.groups.push(group);
    userGroups.totalRequests += group.requestIds.length;
  }

  // Sort by user name, then sort groups within each user by date (most recent first)
  const result = Array.from(userMap.values()).sort((a, b) =>
    a.userName.localeCompare(b.userName)
  );

  for (const user of result) {
    user.groups.sort((a, b) => b.dateStart.localeCompare(a.dateStart));
  }

  return result;
}

/**
 * Format a date for display
 */
export function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr + "T12:00:00Z");
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/**
 * Format a date range for display
 * e.g., "Du 1 févr. au 4 févr." or just "1 févr." for single day
 */
export function formatDateRange(dateStart: string, dateEnd: string): string {
  if (dateStart === dateEnd) {
    return formatDateShort(dateStart);
  }
  return `Du ${formatDateShort(dateStart)} au ${formatDateShort(dateEnd)}`;
}
