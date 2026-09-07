import { safeArr, safeArt, safeObj } from '../safeHelpers';
import { jobLiveArtIds } from '../businessLogic';

// The artist modal intentionally stays open while the order refreshes in the background. A split,
// merge, or art reassignment can therefore leave its captured job object stale even though the SO
// in React state is current. Resolve the job again before an approval action so every gate and
// write works from the same live item/art scope.
export const approvalArtContext = (modalJob, liveOrder, liveJobs) => {
  const currentJob = safeArr(liveJobs).find(j => j?.id === modalJob?.id) || modalJob;
  const artIds = jobLiveArtIds(currentJob, liveOrder);
  const hasImage = a => !!(a && (
    a.preview_url || a.web_logo_url || safeArr(a.web_logos).length ||
    safeArr(a.mockup_files).length || safeArr(a.sample_art).length ||
    Object.values(safeObj(a.item_mockups)).some(v => safeArr(v).length > 0)
  ));
  const missingImages = artIds
    .map(id => safeArt(liveOrder).find(a => a.id === id))
    .filter(Boolean)
    .filter(a => !hasImage(a));
  return { currentJob, artIds, missingImages };
};
