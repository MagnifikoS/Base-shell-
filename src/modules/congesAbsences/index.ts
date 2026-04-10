/**
 * Congés & Absences Module - Public Exports
 * 
 * Module autonome et supprimable:
 *   rm -rf src/modules/congesAbsences/
 *   + retirer navRegistry entry
 *   + retirer route App.tsx
 *   + retirer ModuleKey
 */

// Feature flag
export { CONGES_ABSENCES_ENABLED } from "./feature";

// Types
export type {
  AbsenceDeclaration,
  AbsenceRecord,
  UnifiedAbsenceRecord,
  DeclareAbsenceResponse,
  ListAbsencesResponse,
  UploadJustificatifResponse,
} from "./types";

// Hooks - my absences (SSOT for employee)
export { useMyAllAbsences } from "./hooks/useMyAllAbsences";
export { useEmployeeHourlyRate } from "./hooks/useEmployeeHourlyRate";

// Hooks - workflow demandes (manager only now)
export {
  useLeaveRequestsManager,
  useDeclareLeaveRequest,
  useReviewLeaveRequests,
  isLeaveConflictError,
} from "./hooks/useLeaveRequests";

export type {
  LeaveRequest,
  DeclareLeaveRequestParams,
  ReviewLeaveRequestsParams,
  LeaveConflictError,
} from "./hooks/useLeaveRequests";

// Components
export { EmployeeAbsencesPortal } from "./components/EmployeeAbsencesPortal";

// Pages
export { CongesAbsencesPage } from "./CongesAbsencesPage";
export { MobileCongesAbsences } from "./mobile/MobileCongesAbsences";
