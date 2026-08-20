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

describe('createSupabaseRpcClient', () => {
  test('posts RPC requests directly to Supabase with the public key headers', async () => {
    const calls = [];
    const fetchFn = async (...args) => {
      calls.push(args);
      return {
        ok: true,
        status: 200,
        async json() {
          return { board: { id: 'board-1' }, tasks: [], comments: [] };
        },
      };
    };
    const rpcClient = client.createSupabaseRpcClient({
      url: 'https://audit-project.supabase.co/',
      anonKey: 'public-anon-key',
      fetchFn,
    });

    const result = await rpcClient.rpc('board_snapshot', { token: 'opaque-token' });

    expect(result).toEqual({
      data: { board: { id: 'board-1' }, tasks: [], comments: [] },
      error: null,
    });
    expect(calls).toEqual([[
      'https://audit-project.supabase.co/rest/v1/rpc/board_snapshot',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer public-anon-key',
          'Content-Type': 'application/json',
          apikey: 'public-anon-key',
        },
        body: '{"token":"opaque-token"}',
      },
    ]]);
  });

  test('turns a Supabase HTTP error into the error contract consumed by createBoardApi', async () => {
    const rpcClient = client.createSupabaseRpcClient({
      url: 'https://audit-project.supabase.co',
      anonKey: 'public-anon-key',
      fetchFn: async () => ({
        ok: false,
        status: 400,
        async json() {
          return { code: '22023', message: 'invalid board token', details: 'Capability mismatch', hint: null };
        },
      }),
    });
    const api = client.createBoardApi(rpcClient, 'opaque-token');

    await expect(api.snapshot()).rejects.toMatchObject({
      name: 'SupabaseRpcError',
      message: 'invalid board token',
      status: 400,
      code: '22023',
      details: 'Capability mismatch',
    });
  });

  test('uploads a media file to the board-scoped Storage path and returns a public URL', async () => {
    const calls = [];
    const rpcClient = client.createSupabaseRpcClient({
      url: 'https://audit-project.supabase.co/',
      anonKey: 'public-anon-key',
      fetchFn: async (...args) => {
        calls.push(args);
        return { ok: true, status: 200, async json() { return { Key: 'ignored' }; } };
      },
    });
    const file = { name: 'room photo.jpg', type: 'image/jpeg', size: 3 };

    const result = await rpcClient.upload({
      token: 'opaque-token',
      file,
    });

    expect(result.type).toBe('image');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.name).toBe('room photo.jpg');
    expect(result.size).toBe(3);
    expect(result.path).toMatch(/^opaque-token\/[^/]+-room-photo\.jpg$/);
    expect(result.url).toContain('/storage/v1/object/public/audit-media/opaque-token/');
    expect(calls[0][0]).toMatch(/^https:\/\/audit-project\.supabase\.co\/storage\/v1\/object\/audit-media\/opaque-token\//);
    expect(calls[0][1]).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer public-anon-key',
        apikey: 'public-anon-key',
        'Content-Type': 'image/jpeg',
        'x-upsert': 'false',
      },
      body: file,
    });
  });
});

describe('chat message API', () => {
  test('publishes replies, attachments, and reactions through exact RPC contracts', async () => {
    const calls = [];
    const api = client.createBoardApi({
      async rpc(name, args) {
        calls.push([name, args]);
        return { data: { ok: true }, error: null };
      },
      async upload({ file }) {
        return { type: 'image', name: file.name, mimeType: file.type, size: file.size, path: 'p', url: 'u' };
      },
    }, 'opaque-token');

    await api.addBoardMessage({ author: 'Ada', body: 'Photo', parentCommentId: 'comment-1', attachments: [{ path: 'p', url: 'u' }] });
    await api.addTaskMessage({ author: 'Ada', taskId: 'task-1', body: 'Reply', parentCommentId: null, attachments: [] });
    await api.toggleReaction({ author: 'Ada', commentId: 'comment-1', emoji: '❤️' });

    expect(calls).toEqual([
      ['add_board_message', { token: 'opaque-token', author: 'Ada', body: 'Photo', parent_comment_id: 'comment-1', attachments: [{ path: 'p', url: 'u' }] }],
      ['add_task_message', { token: 'opaque-token', author: 'Ada', task_id: 'task-1', body: 'Reply', parent_comment_id: null, attachments: [] }],
      ['toggle_comment_reaction', { token: 'opaque-token', author: 'Ada', comment_id: 'comment-1', emoji: '❤️' }],
    ]);
  });
});
