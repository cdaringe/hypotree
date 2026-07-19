import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';

import styles from './App.module.css';
import Icon from './Icon';

type Hypothesis = {
  id: string;
  statement: string;
  observations: { id: string; text: string }[];
  children: Hypothesis[];
  collapsed: boolean;
};

type Workspace = { problem: string; hypotheses: Hypothesis[] };
type StoredWorkspace = { workspace: Workspace; updatedAt: number };

const STORAGE_KEY = 'dire-method:workspace:v1';

const uid = () => Math.random().toString(36).slice(2, 10);
const newHypothesis = (): Hypothesis => ({
  id: uid(),
  statement: '',
  observations: [],
  children: [],
  collapsed: false,
});

const encodeWorkspace = (stored: StoredWorkspace) => {
  const bytes = new TextEncoder().encode(JSON.stringify(stored));
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};

const decodeWorkspace = (value: string): unknown => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
};

const isWorkspace = (value: unknown): value is Workspace => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Workspace>;
  return typeof candidate.problem === 'string' && Array.isArray(candidate.hypotheses);
};

const asStoredWorkspace = (value: unknown): StoredWorkspace | null => {
  if (isWorkspace(value)) return { workspace: value, updatedAt: 0 };
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<StoredWorkspace>;
  return isWorkspace(candidate.workspace) && typeof candidate.updatedAt === 'number'
    ? { workspace: candidate.workspace, updatedAt: candidate.updatedAt }
    : null;
};

const loadWorkspace = (): Workspace => {
  try {
    const hash = new URLSearchParams(location.hash.slice(1)).get('tree');
    const fromUrl = hash ? asStoredWorkspace(decodeWorkspace(hash)) : null;
    const fromStorage = asStoredWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    const newest = [fromUrl, fromStorage]
      .filter((entry): entry is StoredWorkspace => entry !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (newest) return newest.workspace;
  } catch (error) {
    console.warn('Could not restore the hypothesis tree', error);
  }
  return { problem: '', hypotheses: [newHypothesis()] };
};

const replaceNode = (
  nodes: Hypothesis[],
  id: string,
  update: (node: Hypothesis) => Hypothesis,
): Hypothesis[] => nodes.map((node) =>
  node.id === id ? update(node) : { ...node, children: replaceNode(node.children, id, update) },
);

const removeNode = (nodes: Hypothesis[], id: string): Hypothesis[] => nodes
  .filter((node) => node.id !== id)
  .map((node) => ({ ...node, children: removeNode(node.children, id) }));

const HypothesisCard: Component<{
  node: Hypothesis;
  depth: number;
  update: (id: string, update: (node: Hypothesis) => Hypothesis) => void;
  remove: (id: string) => void;
}> = (props) => {
  const addObservation = () => props.update(props.node.id, (node) => ({
    ...node,
    observations: [...node.observations, { id: uid(), text: '' }],
  }));

  return (
    <article class={styles.node} data-depth={props.depth}>
      <div class={styles.nodeRail} aria-hidden="true" />
      <div class={styles.card}>
        <div class={styles.cardHeader}>
          <button
            class={styles.collapseButton}
            onClick={() => props.update(props.node.id, (node) => ({ ...node, collapsed: !node.collapsed }))}
            aria-label={props.node.collapsed ? 'Expand hypothesis' : 'Collapse hypothesis'}
            aria-expanded={!props.node.collapsed}
          >
            <span classList={{ [styles.chevron]: true, [styles.chevronClosed]: props.node.collapsed }}>⌄</span>
          </button>
          <span class={styles.nodeType}>HYPOTHESIS</span>
          <span class={styles.summary}>{props.node.collapsed && (props.node.statement || 'Untitled hypothesis')}</span>
          <button class={`${styles.iconButton} ${styles.dangerButton}`} onClick={() => props.remove(props.node.id)} aria-label="Delete hypothesis">
            <Icon name="delete" size={16} />
          </button>
        </div>

        <Show when={!props.node.collapsed}>
          <div class={styles.cardBody}>
            <textarea
              class={styles.hypothesisInput}
              value={props.node.statement}
              onInput={(event) => props.update(props.node.id, (node) => ({ ...node, statement: event.currentTarget.value }))}
              placeholder="If … then … because …"
              rows={2}
              aria-label="Hypothesis statement"
            />

            <Show when={props.node.observations.length > 0}>
              <div class={styles.observations}>
                <div class={styles.sectionLabel}>OBSERVATIONS <span>{props.node.observations.length}</span></div>
                <Index each={props.node.observations}>{(observation) => (
                  <div class={styles.observation}>
                    <span class={styles.observationMark}>↳</span>
                    <input
                      value={observation().text}
                      onInput={(event) => props.update(props.node.id, (node) => ({
                        ...node,
                        observations: node.observations.map((item) => item.id === observation().id ? { ...item, text: event.currentTarget.value } : item),
                      }))}
                      placeholder="What did you observe?"
                      aria-label="Observation"
                    />
                    <button
                      class={styles.removeObservation}
                      onClick={() => props.update(props.node.id, (node) => ({ ...node, observations: node.observations.filter((item) => item.id !== observation().id) }))}
                      aria-label="Delete observation"
                    >×</button>
                  </div>
                )}</Index>
              </div>
            </Show>

            <div class={styles.actions}>
              <button class={styles.textButton} onClick={addObservation}><span>＋</span> Observation</button>
              <button class={styles.textButton} onClick={() => props.update(props.node.id, (node) => ({ ...node, children: [...node.children, newHypothesis()] }))}>
                <span>⑂</span> Sub-hypothesis
              </button>
            </div>
          </div>

          <Show when={props.node.children.length > 0}>
            <div class={styles.children}>
              <Index each={props.node.children}>{(child) => (
                <HypothesisCard node={child()} depth={props.depth + 1} update={props.update} remove={props.remove} />
              )}</Index>
            </div>
          </Show>
        </Show>
      </div>
    </article>
  );
};

const App: Component = () => {
  const [workspace, setWorkspace] = createSignal<Workspace>(loadWorkspace());
  const [saveState, setSaveState] = createSignal('Saved');
  const [copied, setCopied] = createSignal(false);
  let saveTimer: number | undefined;

  const persist = (snapshot = workspace()) => {
    window.clearTimeout(saveTimer);
    const stored = { workspace: snapshot, updatedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    const params = new URLSearchParams({ tree: encodeWorkspace(stored) });
    history.replaceState(null, '', `${location.pathname}${location.search}#${params}`);
    setSaveState('Saved');
  };

  createEffect(() => {
    const snapshot = workspace();
    setSaveState('Saving…');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persist(snapshot), 500);
  });

  onMount(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        persist();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    onCleanup(() => window.removeEventListener('keydown', handleSaveShortcut));
  });
  onCleanup(() => window.clearTimeout(saveTimer));

  const updateNode = (id: string, update: (node: Hypothesis) => Hypothesis) => {
    setWorkspace((current) => ({ ...current, hypotheses: replaceNode(current.hypotheses, id, update) }));
  };

  const share = async () => {
    persist();
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this shareable link', location.href);
    }
  };

  return (
    <main class={styles.app}>
      <header class={styles.topbar}>
        <div class={styles.brand}><span class={styles.brandMark}>D</span><span>DIRE METHOD</span></div>
        <div class={styles.headerActions}>
          <span class={styles.saveState}><span class={styles.statusDot} />{saveState()}</span>
          <button class={styles.shareButton} onClick={share}><Icon name="link" size={16} /> {copied() ? 'Copied' : 'Share'}</button>
        </div>
      </header>

      <div class={styles.workspace}>
        <section class={styles.problemSection}>
          <div class={styles.panelHeading}>
            <label for="problem"><span class={styles.prompt}>›</span> PROBLEM</label>
            <span>01</span>
          </div>
          <textarea
            id="problem"
            value={workspace().problem}
            onInput={(event) => setWorkspace((current) => ({ ...current, problem: event.currentTarget.value }))}
            placeholder="What are you trying to understand or solve?"
            rows={3}
          />
        </section>

        <section class={styles.treeSection}>
          <div class={styles.treeHeading}>
            <div><span class={styles.prompt}>›</span><span class={styles.treeLabel}>HYPOTHESES</span><span class={styles.count}>{workspace().hypotheses.length.toString().padStart(2, '0')}</span></div>
            <button class={styles.primaryButton} onClick={() => setWorkspace((current) => ({ ...current, hypotheses: [...current.hypotheses, newHypothesis()] }))}>
              ＋ New hypothesis
            </button>
          </div>

          <div class={styles.tree}>
            <Show when={workspace().hypotheses.length > 0} fallback={
              <div class={styles.emptyState}><p>No hypotheses yet.</p><button onClick={() => setWorkspace((current) => ({ ...current, hypotheses: [newHypothesis()] }))}>Create one</button></div>
            }>
              <Index each={workspace().hypotheses}>{(node) => (
                <HypothesisCard
                  node={node()}
                  depth={0}
                  update={updateNode}
                  remove={(id) => setWorkspace((current) => ({ ...current, hypotheses: removeNode(current.hypotheses, id) }))}
                />
              )}</Index>
            </Show>
          </div>
        </section>
      </div>
      <footer><span>Stored locally</span><span>Shareable snapshot</span></footer>
    </main>
  );
};

export default App;
