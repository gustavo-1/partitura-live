/**
 * Testes das regras de segurança do Firestore (precisa do emulador).
 * Rode com:  npm run test:rules
 */
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
let env: RulesTestEnvironment;

const msg = (from: string, extra: Record<string, unknown> = {}) => ({
  from,
  fromName: 'Ana',
  type: 'cheer',
  text: 'Parabéns!',
  createdAt: Date.now(),
  read: false,
  ...extra,
});

describe.skipIf(!HOST)('regras do Firestore', () => {
  beforeAll(async () => {
    const [host, port] = HOST!.split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-partitura',
      firestore: { host, port: Number(port), rules: readFileSync(join(__dirname, '..', 'firestore.rules'), 'utf8') },
    });
  });
  afterAll(async () => {
    await env?.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
  });

  const db = (uid: string | null) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore());

  async function makeFriends(a: string, b: string) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const [x, y] = [a, b].sort();
      await ctx.firestore().doc(`friendships/${x}_${y}`).set({ members: [x, y], createdAt: 1 });
    });
  }

  it('dados privados: só o dono lê e escreve', async () => {
    await assertSucceeds(db('alice').doc('users/alice').set({ progress: { xp: 1 } }));
    await assertSucceeds(db('alice').doc('users/alice').get());
    await assertFails(db('bob').doc('users/alice').get());
    await assertFails(db('bob').doc('users/alice').set({ progress: { xp: 999 } }));
    await assertFails(db(null).doc('users/alice').get());
    await assertSucceeds(db('alice').doc('users/alice/songs/s1').set({ title: 'x' }));
    await assertFails(db('bob').doc('users/alice/songs/s1').get());
  });

  it('perfil público: logado lê um perfil, ninguém lista, só o dono escreve', async () => {
    await assertSucceeds(db('alice').doc('profiles/alice').set({ uid: 'alice', name: 'Alice', code: 'ABC234' }));
    await assertSucceeds(db('bob').doc('profiles/alice').get());
    await assertFails(db(null).doc('profiles/alice').get());
    await assertFails(db('bob').collection('profiles').get());
    await assertFails(db('bob').doc('profiles/alice').set({ uid: 'alice', name: 'Hacker', code: 'ABC234' }));
    await assertFails(db('alice').doc('profiles/alice').set({ uid: 'bob', name: 'Alice', code: 'ABC234' }));
  });

  it('código de amigo: cria uma vez, não sobrescreve, não lista', async () => {
    await assertSucceeds(db('alice').doc('friendCodes/ABC234').set({ uid: 'alice' }));
    await assertSucceeds(db('bob').doc('friendCodes/ABC234').get());
    await assertFails(db('bob').doc('friendCodes/ABC234').set({ uid: 'bob' }));
    await assertFails(db('bob').doc('friendCodes/XYZ789').set({ uid: 'alice' }));
    await assertFails(db('bob').collection('friendCodes').get());
    await assertFails(db('bob').doc('friendCodes/ABC234').delete());
    await assertSucceeds(db('alice').doc('friendCodes/ABC234').delete());
  });

  it('pedido de amizade e aceite', async () => {
    // bob não pode criar pedido em nome de alice
    await assertFails(db('bob').doc('friendRequests/alice_bob').set({ from: 'alice', to: 'bob', fromName: 'A', createdAt: 1 }));
    await assertSucceeds(db('alice').doc('friendRequests/alice_bob').set({ from: 'alice', to: 'bob', fromName: 'Alice', createdAt: 1 }));
    await assertFails(db('carol').doc('friendRequests/alice_bob').get());
    await assertSucceeds(db('bob').collection('friendRequests').where('to', '==', 'bob').get());
    // alice não pode "aceitar" o próprio pedido
    await assertFails(db('alice').doc('friendships/alice_bob').set({ members: ['alice', 'bob'], createdAt: 1 }));
    // carol não pode se colocar como amiga
    await assertFails(db('carol').doc('friendships/alice_carol').set({ members: ['alice', 'carol'], createdAt: 1 }));
    // bob aceita
    await assertSucceeds(db('bob').doc('friendships/alice_bob').set({ members: ['alice', 'bob'], createdAt: 1 }));
    await assertSucceeds(db('alice').collection('friendships').where('members', 'array-contains', 'alice').get());
    await assertFails(db('carol').doc('friendships/alice_bob').get());
    await assertSucceeds(db('bob').doc('friendRequests/alice_bob').delete());
  });

  it('mensagens: só amigos enviam, assinadas por eles; dono só marca como lida', async () => {
    await assertFails(db('bob').collection('users/alice/inbox').add(msg('bob')));
    await makeFriends('alice', 'bob');
    await assertSucceeds(db('bob').collection('users/alice/inbox').add(msg('bob')));
    await assertFails(db('bob').collection('users/alice/inbox').add(msg('carol')));
    await assertFails(db('bob').collection('users/alice/inbox').add(msg('bob', { type: 'virus' })));
    await assertFails(db('bob').collection('users/alice/inbox').add(msg('bob', { text: 'x'.repeat(400) })));
    await assertFails(db('bob').collection('users/alice/inbox').add(msg('bob', { admin: true })));
    await assertFails(db('carol').collection('users/alice/inbox').add(msg('carol')));
    await assertFails(db('bob').collection('users/alice/inbox').get());
    const snap = await db('alice').collection('users/alice/inbox').get();
    const ref = snap.docs[0].ref;
    await assertSucceeds(db('alice').doc(ref.path).update({ read: true }));
    await assertFails(db('alice').doc(ref.path).update({ text: 'editado' }));
    await assertSucceeds(db('alice').doc(ref.path).delete());
  });
});
