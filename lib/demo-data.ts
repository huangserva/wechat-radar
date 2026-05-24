import { db } from './db';
import { writeConfig } from './config';

const GROUPS = [
  { id: 'demo-ai@chatroom', name: 'AI 产品讨论群' },
  { id: 'demo-coding@chatroom', name: 'Vibe Coding 交流群' },
  { id: 'demo-tools@chatroom', name: '效率工具分享群' },
  { id: 'demo-business@chatroom', name: 'AI 商业增长群' },
  { id: 'demo-life@chatroom', name: '生活与阅读群' },
];

const SENDERS = ['Alex', 'Ming', 'Luna', 'Kai', 'River', 'Yuki', 'Chen'];
const CONTENTS = [
  '有没有适合团队知识库的 AI 工具？最好支持飞书和 Notion，同步成本低一点。',
  '实测 Codex 处理中型前端改版很稳，关键是先给它足够清楚的验收标准。',
  '分享一个开源项目 https://github.com/example/agent-workflow 可以把多 Agent 编排可视化。',
  '这篇文章值得读：AI Agent 落地为什么卡在组织流程 https://mp.weixin.qq.com/s/demo-agent-org',
  '下周有一个 AI 工具内测名额，想找 20 个真实团队试用，感兴趣可以报名。',
  'GEO 和 SEO 的差别今天讨论很多，核心不是关键词，而是结构化证据和可信来源。',
  '有没有人熟悉 Chrome Extension 上架流程？需要一个 checklist。',
  '@你的微信名 这个话题你可能有经验：如何把群聊素材整理成公众号选题？',
  '新的语音转文字工具体验不错 https://example.com/voice-note 支持批量导出 Markdown。',
  '今天最值得关注的是 AI 工具开始从个人效率走向团队工作流。',
];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedDemoData() {
  const database = db();
  const now = new Date();
  const insertMessage = database.prepare(`
    INSERT OR IGNORE INTO messages
      (chatroom_id, local_id, sender, content, time, timestamp, type, date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertStats = database.prepare(`
    INSERT INTO daily_stats (chatroom_id, date, total, top_senders, by_hour, refreshed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id, date) DO UPDATE SET
      total = excluded.total,
      top_senders = excluded.top_senders,
      by_hour = excluded.by_hour,
      refreshed_at = excluded.refreshed_at
  `);

  database.transaction(() => {
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const d = new Date(now);
      d.setDate(now.getDate() - dayOffset);
      const date = ymd(d);
      for (let gi = 0; gi < GROUPS.length; gi++) {
        const group = GROUPS[gi];
        const count = Math.max(8, 42 - dayOffset * 2 + gi * 5);
        const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour >= 9 && hour <= 23 ? Math.floor(count / 15) + ((hour + gi) % 3) : 0 }));
        const topSenders = SENDERS.slice(0, 3).map((sender, index) => ({ sender, count: Math.max(1, Math.floor(count / (index + 2))) }));
        insertStats.run(group.id, date, count, JSON.stringify(topSenders), JSON.stringify(byHour), Date.now());
        for (let i = 0; i < Math.min(count, 18); i++) {
          const localId = dayOffset * 10000 + gi * 1000 + i + 1;
          const hour = 9 + ((i + gi) % 12);
          const minute = (i * 7) % 60;
          const time = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
          const timestamp = Math.floor(new Date(time).getTime() / 1000);
          insertMessage.run(group.id, localId, SENDERS[(i + gi) % SENDERS.length], CONTENTS[(i + gi + dayOffset) % CONTENTS.length], time, timestamp, 'text', date);
        }
      }
    }
  })();

  writeConfig({
    demoMode: true,
    setupCompleted: true,
    privacyConfirmed: true,
    myNicknames: ['你的微信名'],
  });

  return { groups: GROUPS.length, days: 14 };
}
