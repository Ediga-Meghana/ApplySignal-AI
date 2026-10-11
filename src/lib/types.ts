export const STATUSES = ['Saved','Applied','Assessment','Interview','Offer','Rejected'] as const
export type Status = typeof STATUSES[number]
export interface Opportunity { id: string; company: string|null; role: string|null; type: string|null; action: string|null; url: string|null; source: string|null; deadline: string|null; assessment_date: string|null; interview_date: string|null; snippet: string|null; source_text?: string|null; extraction_method?: "ai"|"rules"|null; extracted_at?: string|null; created_at: string }
export interface Application { id: string; opportunity_id: string|null; company: string; role: string; type: string|null; url: string|null; source: string|null; notes: string|null; status: Status; deadline: string|null; assessment_date: string|null; interview_date: string|null; follow_up_date: string|null; created_at: string }
export interface Analysis { id: string; target_role: string|null; matched: string[]; missing: string[]; created_at: string }
export interface Task { id: string; analysis_id: string; title: string; done: boolean }
