import InsightsClient from './InsightsClient';
import { loadInsights } from '@/lib/insights-source';

export const dynamic = 'force-dynamic';

export default function InsightsPage() {
  const data = loadInsights();
  return <InsightsClient initialData={{ ok: true, ...data }} />;
}
