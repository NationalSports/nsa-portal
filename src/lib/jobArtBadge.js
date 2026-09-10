import { PROD_FILES_STATUSES } from '../constants';

// The job owns its workflow; a shared art file cannot imply that this job was submitted.
export const jobArtBadgeSt=(jb,artFile)=>{
  if(jb.art_status==='needs_art')return'needs_art';
  // Coach sent the art back: badge it "Changes Requested" while it's with the artist (still a
  // Waiting-for-Art job for column/sort purposes — see getArtFileStatus, which is unchanged).
  if(jb.coach_rejected&&(jb.art_status==='art_requested'||jb.art_status==='art_in_progress'))return'changes_requested';
  if(jb.art_status==='art_requested'||jb.art_status==='art_in_progress')return'waiting_for_art';
  if(jb.art_status==='waiting_approval')return'needs_approval';
  if(PROD_FILES_STATUSES.includes(jb.art_status))return'approved';
  if(jb.art_status==='art_complete')return'art_complete';
  const wasRecalled=(jb.art_requests||[]).some(r=>r.status==='recalled')&&!(jb.art_requests||[]).some(r=>r.status==='requested'||r.status==='in_progress');
  if(wasRecalled)return'needs_art';
  const s=artFile?.status;return s==='uploaded'?'needs_approval':(!s||s==='needs_art')?'waiting_for_art':s;
};
