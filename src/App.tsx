import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';

import styles from './App.module.css';
import Icon from './Icon';

type Hypothesis = {
  id: string;
  createdAt: number;
  statement: string;
  status?: 'proven' | 'debunked';
  closureReason?: string;
  observations: { id: string; text: string; createdAt: number }[];
  children: Hypothesis[];
  collapsed: boolean;
};

type Workspace = { problem: string; hypotheses: Hypothesis[] };
type AppSettings = { showTimestamps: boolean };
type StoredWorkspace = { workspace: Workspace; settings?: AppSettings; updatedAt: number };

const STORAGE_KEY = 'hypotree:workspace:v1';
const SETTINGS_KEY = 'hypotree:settings:v1';

const loadTimestampSetting = () => {
  try {
    const hash = new URLSearchParams(location.hash.slice(1)).get('tree');
    const fromUrl = hash ? asStoredWorkspace(decodeWorkspace(hash)) : null;
    const fromStorage = asStoredWorkspace(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    const newest = [fromUrl, fromStorage]
      .filter((entry): entry is StoredWorkspace => entry !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (newest?.settings) return newest.settings.showTimestamps;
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').showTimestamps === true;
  } catch {
    return false;
  }
};

const uid = () => Math.random().toString(36).slice(2, 10);
const newHypothesis = (): Hypothesis => ({
  id: uid(),
  createdAt: Date.now(),
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

const addMissingTimestamps = (workspace: Workspace, fallback: number): Workspace => ({
  ...workspace,
  hypotheses: workspace.hypotheses.map(function timestampNode(node): Hypothesis {
    return {
      ...node,
      createdAt: node.createdAt || fallback,
      observations: node.observations.map((observation) => ({
        ...observation,
        createdAt: observation.createdAt || fallback,
      })),
      children: node.children.map(timestampNode),
    };
  }),
});

const asStoredWorkspace = (value: unknown): StoredWorkspace | null => {
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
    if (newest) return addMissingTimestamps(newest.workspace, newest.updatedAt);
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

const setAllCollapsed = (nodes: Hypothesis[], collapsed: boolean): Hypothesis[] =>
  nodes.map((node) => ({ ...node, collapsed, children: setAllCollapsed(node.children, collapsed) }));

const detachNode = (nodes: Hypothesis[], id: string): [Hypothesis[], Hypothesis | null] => {
  let detached: Hypothesis | null = null;
  const remaining = nodes.flatMap((node) => {
    if (node.id === id) {
      detached = node;
      return [];
    }
    const [children, child] = detachNode(node.children, id);
    if (child) detached = child;
    return [{ ...node, children }];
  });
  return [remaining, detached];
};

const appendChild = (nodes: Hypothesis[], parentId: string, child: Hypothesis): Hypothesis[] =>
  nodes.map((node) => node.id === parentId
    ? { ...node, collapsed: false, children: [...node.children, child] }
    : { ...node, children: appendChild(node.children, parentId, child) });

const containsNode = (node: Hypothesis, id: string): boolean =>
  node.id === id || node.children.some((child) => containsNode(child, id));

const insertSibling = (
  nodes: Hypothesis[], targetId: string, moving: Hypothesis, position: 'before' | 'after',
): Hypothesis[] => nodes.flatMap((node) => {
  if (node.id === targetId) return position === 'before' ? [moving, node] : [node, moving];
  return [{ ...node, children: insertSibling(node.children, targetId, moving, position) }];
});

const markdownLine = (value: string) => value.trim().replaceAll('\n', '<br>');
const exportTime = (timestamp: number) => new Date(timestamp).toISOString();
const displayTime = (timestamp: number) => new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'short',
}).format(timestamp);
const hypothesesToMarkdown = (nodes: Hypothesis[], depth = 0): string[] => nodes.flatMap((node) => {
  const indent = '  '.repeat(depth);
  const lines = [`${indent}- **Hypothesis:** ${markdownLine(node.statement) || '_Untitled_'}`];
  lines.push(`${indent}  - **Added:** ${exportTime(node.createdAt)}`);
  if (node.status) lines.push(`${indent}  - **Status:** ${node.status === 'proven' ? 'Proven' : 'Debunked'}`);
  if (node.status && node.closureReason) lines.push(`${indent}  - **Reason:** ${markdownLine(node.closureReason)}`);
  node.observations.forEach((observation) => {
    if (observation.text.trim()) {
      lines.push(`${indent}  - **Observation:** ${markdownLine(observation.text)}`);
      lines.push(`${indent}    - **Added:** ${exportTime(observation.createdAt)}`);
    }
  });
  return [...lines, ...hypothesesToMarkdown(node.children, depth + 1)];
});

const workspaceToMarkdown = (workspace: Workspace) => [
  '# Problem', '', workspace.problem.trim() || '_Not defined_', '',
  '# Hypotheses', '', ...hypothesesToMarkdown(workspace.hypotheses), '',
].join('\n');

const resizeObservation = (element: HTMLTextAreaElement) => {
  element.style.height = '0';
  element.style.height = `${element.scrollHeight}px`;
};

const HypothesisCard: Component<{
  node: Hypothesis;
  depth: number;
  update: (id: string, update: (node: Hypothesis) => Hypothesis) => void;
  remove: (id: string) => void;
  draggingId: () => string | null;
  dropTarget: () => string | null;
  setDropTarget: (id: string | null) => void;
  startDragging: (id: string, event: DragEvent) => void;
  finishDragging: () => void;
  reparent: (id: string, targetId: string | null, position?: 'before' | 'inside' | 'after') => void;
  showTimestamps: () => boolean;
}> = (props) => {
  const addObservation = () => props.update(props.node.id, (node) => ({
    ...node,
    observations: [...node.observations, { id: uid(), text: '', createdAt: Date.now() }],
  }));

  return (
    <article
      classList={{
        [styles.node]: true,
        [styles.dropTarget]: props.dropTarget() === `inside:${props.node.id}`,
        [styles.dropBefore]: props.dropTarget() === `before:${props.node.id}`,
        [styles.dropAfter]: props.dropTarget() === `after:${props.node.id}`,
      }}
      data-depth={props.depth}
      onDragOver={(event) => {
        if (props.draggingId() && props.draggingId() !== props.node.id) {
          event.preventDefault();
          event.stopPropagation();
          const header = event.currentTarget.querySelector(`.${styles.cardHeader}`)?.getBoundingClientRect();
          const position = header && event.clientY < header.top + header.height * .3
            ? 'before'
            : header && event.clientY > header.bottom - header.height * .3
              ? 'after'
              : 'inside';
          props.setDropTarget(`${position}:${props.node.id}`);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const draggedId = props.draggingId() || event.dataTransfer?.getData('text/plain');
        const [position = 'inside', targetId = props.node.id] = (props.dropTarget() || '').split(':');
        if (draggedId) props.reparent(draggedId, targetId, position as 'before' | 'inside' | 'after');
        props.finishDragging();
      }}
    >
      <div class={styles.nodeRail} aria-hidden="true" />
      <div class={styles.card}>
        <div class={styles.cardHeader}>
          <span
            class={styles.dragHandle}
            draggable={true}
            onDragStart={(event) => props.startDragging(props.node.id, event)}
            onDragEnd={props.finishDragging}
            role="button"
            tabIndex={0}
            aria-label="Drag to move hypothesis"
            title="Drag to move"
          >⠿</span>
          <button
            class={styles.collapseButton}
            onClick={() => props.update(props.node.id, (node) => ({ ...node, collapsed: !node.collapsed }))}
            aria-label={props.node.collapsed ? 'Expand hypothesis' : 'Collapse hypothesis'}
            aria-expanded={!props.node.collapsed}
          >
            <span classList={{ [styles.chevron]: true, [styles.chevronClosed]: props.node.collapsed }}>⌄</span>
          </button>
          <span class={styles.nodeType}>HYPOTHESIS</span>
          <span class={styles.summary} title={props.node.statement}>
            {props.node.collapsed && (props.node.statement || 'Untitled hypothesis')}
          </span>
          <Show when={props.showTimestamps()}>
            <time class={styles.nodeTime} dateTime={new Date(props.node.createdAt).toISOString()}>{displayTime(props.node.createdAt)}</time>
          </Show>
          <div class={styles.outcomeControls} aria-label="Hypothesis outcome">
            <button
              classList={{ [styles.outcomeButton]: true, [styles.provenActive]: props.node.status === 'proven' }}
              onClick={() => props.update(props.node.id, (node) => ({ ...node, status: node.status === 'proven' ? undefined : 'proven' }))}
              aria-pressed={props.node.status === 'proven'}
              title="Mark as proven"
            >✓ <span>Proven</span></button>
            <button
              classList={{ [styles.outcomeButton]: true, [styles.debunkedActive]: props.node.status === 'debunked' }}
              onClick={() => props.update(props.node.id, (node) => ({ ...node, status: node.status === 'debunked' ? undefined : 'debunked' }))}
              aria-pressed={props.node.status === 'debunked'}
              title="Mark as debunked"
            >× <span>Debunked</span></button>
          </div>
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

            <Show when={props.node.status}>
              <div classList={{
                [styles.closure]: true,
                [styles.provenClosure]: props.node.status === 'proven',
                [styles.debunkedClosure]: props.node.status === 'debunked',
              }}>
                <span class={styles.closureLabel}>{props.node.status === 'proven' ? 'PROVEN' : 'DEBUNKED'} — REASON</span>
                <textarea
                  value={props.node.closureReason || ''}
                  ref={(element) => queueMicrotask(() => {
                    resizeObservation(element);
                    element.focus();
                  })}
                  onInput={(event) => {
                    resizeObservation(event.currentTarget);
                    props.update(props.node.id, (node) => ({ ...node, closureReason: event.currentTarget.value }));
                  }}
                  placeholder={props.node.status === 'proven' ? 'What evidence proved this hypothesis?' : 'What evidence debunked this hypothesis?'}
                  aria-label={`Reason hypothesis was ${props.node.status}`}
                  rows={1}
                />
              </div>
            </Show>

            <Show when={props.node.observations.length > 0}>
              <div class={styles.observations}>
                <div class={styles.sectionLabel}>OBSERVATIONS <span>{props.node.observations.length}</span></div>
                <Index each={props.node.observations}>{(observation) => (
                  <div class={styles.observation}>
                    <span class={styles.observationMark}>↳</span>
                    <div class={styles.observationContent}>
                      <Show when={props.showTimestamps()}>
                        <time class={styles.observationTime} dateTime={new Date(observation().createdAt).toISOString()}>Added {displayTime(observation().createdAt)}</time>
                      </Show>
                      <textarea
                        value={observation().text}
                        ref={(element) => queueMicrotask(() => resizeObservation(element))}
                        onInput={(event) => {
                          resizeObservation(event.currentTarget);
                          props.update(props.node.id, (node) => ({
                            ...node,
                            observations: node.observations.map((item) => item.id === observation().id ? { ...item, text: event.currentTarget.value } : item),
                          }));
                        }}
                        placeholder="What did you observe?"
                        aria-label="Observation"
                        rows={1}
                      />
                    </div>
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
                <HypothesisCard
                  node={child()}
                  depth={props.depth + 1}
                  update={props.update}
                  remove={props.remove}
                  draggingId={props.draggingId}
                  dropTarget={props.dropTarget}
                  setDropTarget={props.setDropTarget}
                  startDragging={props.startDragging}
                  finishDragging={props.finishDragging}
                  reparent={props.reparent}
                  showTimestamps={props.showTimestamps}
                />
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
  const [markdownCopied, setMarkdownCopied] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
  const [showTimestamps, setShowTimestamps] = createSignal(loadTimestampSetting());
  const [draggingId, setDraggingId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  let saveTimer: number | undefined;

  const persist = (snapshot = workspace()) => {
    window.clearTimeout(saveTimer);
    const stored: StoredWorkspace = {
      workspace: snapshot,
      settings: { showTimestamps: showTimestamps() },
      updatedAt: Date.now(),
    };
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
  createEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showTimestamps: showTimestamps() }));
    persist();
  });

  onMount(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHelp(false);
        setShowSettings(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        persist();
      }
    };
    const preventGestureZoom = (event: Event) => event.preventDefault();
    const preventPinchZoom = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    const preventDoubleTapZoom = (event: MouseEvent) => event.preventDefault();

    window.addEventListener('keydown', handleSaveShortcut);
    document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
    document.addEventListener('gestureend', preventGestureZoom, { passive: false });
    document.addEventListener('touchmove', preventPinchZoom, { passive: false });
    document.addEventListener('dblclick', preventDoubleTapZoom, { passive: false });
    onCleanup(() => {
      window.removeEventListener('keydown', handleSaveShortcut);
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
      document.removeEventListener('gestureend', preventGestureZoom);
      document.removeEventListener('touchmove', preventPinchZoom);
      document.removeEventListener('dblclick', preventDoubleTapZoom);
    });
  });
  onCleanup(() => window.clearTimeout(saveTimer));

  const updateNode = (id: string, update: (node: Hypothesis) => Hypothesis) => {
    setWorkspace((current) => ({ ...current, hypotheses: replaceNode(current.hypotheses, id, update) }));
  };

  const reparent = (id: string, targetId: string | null, position: 'before' | 'inside' | 'after' = 'inside') => {
    setWorkspace((current) => {
      const [remaining, moving] = detachNode(current.hypotheses, id);
      if (!moving || (targetId && containsNode(moving, targetId))) return current;
      return {
        ...current,
        hypotheses: targetId
          ? position === 'inside'
            ? appendChild(remaining, targetId, moving)
            : insertSibling(remaining, targetId, moving, position)
          : [...remaining, moving],
      };
    });
  };

  const finishDragging = () => {
    setDraggingId(null);
    setDropTarget(null);
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

  const copyMarkdown = async () => {
    const markdown = workspaceToMarkdown(workspace());
    try {
      await navigator.clipboard.writeText(markdown);
      setMarkdownCopied(true);
      window.setTimeout(() => setMarkdownCopied(false), 1600);
    } catch {
      window.prompt('Copy this Markdown', markdown);
    }
  };

  return (
    <main class={styles.app}>
      <header class={styles.topbar}>
        <div class={styles.brand}><span class={styles.brandMark}>H</span><span>HYPOTREE</span></div>
        <div class={styles.headerActions}>
          <span class={styles.saveState}><span class={styles.statusDot} />{saveState()}</span>
          <button class={styles.helpButton} onClick={() => setShowHelp(true)}>How to</button>
          <div class={styles.settingsWrap}>
            <button class={styles.settingsButton} onClick={() => setShowSettings((open) => !open)} aria-expanded={showSettings()} aria-haspopup="menu">
              <Icon name="settings" size={16} /> Settings
            </button>
            <Show when={showSettings()}>
              <div class={styles.settingsMenu} role="menu">
                <label>
                  <input type="checkbox" checked={showTimestamps()} onChange={(event) => setShowTimestamps(event.currentTarget.checked)} />
                  <span><strong>Show timestamps</strong><small>Display when entries were added</small></span>
                </label>
              </div>
            </Show>
          </div>
          <button class={styles.copyButton} onClick={copyMarkdown}><span>⧉</span> {markdownCopied() ? 'Copied' : 'Markdown'}</button>
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
          <div
            classList={{ [styles.treeHeading]: true, [styles.rootDropActive]: dropTarget() === 'root' }}
            onDragOver={(event) => {
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
              setDropTarget('root');
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = draggingId() || event.dataTransfer?.getData('text/plain');
              if (id) reparent(id, null);
              finishDragging();
            }}
          >
            <div><span class={styles.prompt}>›</span><span class={styles.treeLabel}>{draggingId() ? 'DROP HERE FOR ROOT' : 'HYPOTHESES'}</span><span class={styles.count}>{workspace().hypotheses.length.toString().padStart(2, '0')}</span></div>
            <div class={styles.treeActions}>
              <div class={styles.expandActions}>
                <button onClick={() => setWorkspace((current) => ({ ...current, hypotheses: setAllCollapsed(current.hypotheses, false) }))} title="Expand every hypothesis">Expand all</button>
                <button onClick={() => setWorkspace((current) => ({ ...current, hypotheses: setAllCollapsed(current.hypotheses, true) }))} title="Collapse every hypothesis">Collapse all</button>
              </div>
              <button class={styles.primaryButton} onClick={() => setWorkspace((current) => ({ ...current, hypotheses: [...current.hypotheses, newHypothesis()] }))}>
                ＋ New hypothesis
              </button>
            </div>
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
                  draggingId={draggingId}
                  dropTarget={dropTarget}
                  setDropTarget={setDropTarget}
                  startDragging={(id, event) => {
                    event.dataTransfer?.setData('text/plain', id);
                    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
                    setDraggingId(id);
                  }}
                  finishDragging={finishDragging}
                  reparent={reparent}
                  showTimestamps={showTimestamps}
                />
              )}</Index>
            </Show>
          </div>
        </section>
      </div>
      <footer><span>Stored locally</span><span>Shareable snapshot</span></footer>

      <Show when={showHelp()}>
        <div
          class={styles.helpBackdrop}
          onClick={(event) => event.target === event.currentTarget && setShowHelp(false)}
        >
          <section class={styles.helpPanel} role="dialog" aria-modal="true" aria-labelledby="how-to-title">
            <header class={styles.helpHeader}>
              <div><span class={styles.prompt}>›</span><h2 id="how-to-title">How to use Hypotree</h2></div>
              <button onClick={() => setShowHelp(false)} aria-label="Close guide">×</button>
            </header>
            <div class={styles.helpBody}>
              <ol>
                <li><strong>Define the problem.</strong><span>Write the question or failure you are trying to understand.</span></li>
                <li><strong>Form hypotheses.</strong><span>Add possible explanations. Use sub-hypotheses to break a claim into smaller testable claims.</span></li>
                <li><strong>Record observations.</strong><span>Attach evidence to the hypothesis it supports or challenges.</span></li>
                <li><strong>Reach a conclusion.</strong><span>Mark a hypothesis Proven or Debunked, then record the reason.</span></li>
              </ol>
              <div class={styles.helpTip}><strong>Move hypotheses</strong><p>Drag the ⠿ handle. Drop on a card’s top edge to place before, center to make it a child, or bottom edge to place after. Drop on the Hypotheses header to move it to the root.</p></div>
              <div class={styles.helpTip}><strong>Save and share</strong><p>Changes save automatically. Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> to save immediately. Share copies a snapshot URL; Markdown copies the document as text.</p></div>
            </div>
          </section>
        </div>
      </Show>
    </main>
  );
};

export default App;
