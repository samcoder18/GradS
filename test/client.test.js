import { describe, expect, test } from 'vitest';
import * as client from '../src/client.js';

describe('parseAuditReport', () => {
  test('preserves report text while grouping second-level sections for disclosures', () => {
    const markdown = [
      '# Main audit',
      '',
      'Introductory evidence.',
      '',
      '## 1. Summary',
      '',
      'Summary body.',
      '',
      '### Detail',
      '',
      '- First finding',
      '',
      '## Appendix',
      '',
      'Runtime notes.',
    ].join('\n');

    expect(client.parseAuditReport(markdown)).toEqual({
      title: 'Main audit',
      introduction: 'Introductory evidence.',
      sections: [
        {
          id: 'report-1-summary',
          title: '1. Summary',
          body: 'Summary body.\n\n### Detail\n\n- First finding',
        },
        { id: 'report-appendix', title: 'Appendix', body: 'Runtime notes.' },
      ],
    });
  });
});

describe('createBoardApi', () => {
  test('uses only the five published RPCs with their exact snake_case arguments', async () => {
    const calls = [];
    const supabase = {
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: { ok: name }, error: null };
      },
    };
    const api = client.createBoardApi(supabase, 'opaque-token');

    await api.snapshot();
    await api.createTask({ author: 'Ada', title: 'Task', description: 'Details', priority: 'P1' });
    await api.setCompleted({ author: 'Ada', taskId: 'task-1', completed: true });
    await api.addTaskComment({ author: 'Ada', taskId: 'task-1', body: 'Done.' });
    await api.addBoardComment({ author: 'Ada', body: 'Board note.' });

    expect(calls).toEqual([
      ['board_snapshot', { token: 'opaque-token' }],
      ['create_task', { token: 'opaque-token', author: 'Ada', title: 'Task', description: 'Details', priority: 'P1' }],
      ['set_task_completed', { token: 'opaque-token', author: 'Ada', task_id: 'task-1', completed: true }],
      ['add_task_comment', { token: 'opaque-token', author: 'Ada', task_id: 'task-1', body: 'Done.' }],
      ['add_board_comment', { token: 'opaque-token', author: 'Ada', body: 'Board note.' }],
    ]);
  });

  test('surfaces an RPC failure instead of treating it as data', async () => {
    const error = new Error('Invalid board link');
    const api = client.createBoardApi({ rpc: async () => ({ data: null, error }) }, 'opaque-token');

    await expect(api.snapshot()).rejects.toBe(error);
  });
});
