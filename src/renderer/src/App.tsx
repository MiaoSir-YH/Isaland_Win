import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  MessageCircle,
  Settings,
  ShieldAlert,
  Terminal
} from 'lucide-react';
import type {
  AgentSession,
  AppSnapshot,
  NormalizedEvent,
  PermissionDecision,
  PermissionRequest
} from '@shared/types';
import {
  getIslandAttentionReason,
  shouldAutoClearIslandNotification,
  type IslandAttentionReason
} from '@shared/attention';
import { EventList, SessionStrip } from './activityLists';
import { getPermissionNoticeTimeoutMs } from '@shared/permission';
import { agentLabels, dictionaries, getDictionary } from './i18n';
import { formatRisk, getActionableKindLabel, InlinePermissionActions, PermissionPanel } from './PermissionPanel';
import { SettingsView } from './SettingsView';
import './styles.css';

const ISLAND_NOTIFICATION_PROGRESS_MS = 10000;
const ISLAND_BAR_CANVAS_HEIGHT = 68;
const ISLAND_CANVAS_WIDTH = 576;
const ISLAND_VISUAL_MAX_WIDTH = 528;
const ISLAND_PANEL_CANVAS_HEIGHT = 372;
const ISLAND_SHELL_PADDING_TOP = 12;
const ISLAND_SHELL_PADDING_BOTTOM = 42;
const ISLAND_BAR_WINDOW_HEIGHT = ISLAND_BAR_CANVAS_HEIGHT + ISLAND_SHELL_PADDING_TOP + ISLAND_SHELL_PADDING_BOTTOM;
const ISLAND_PANEL_WINDOW_HEIGHT =
  ISLAND_PANEL_CANVAS_HEIGHT + ISLAND_SHELL_PADDING_TOP + ISLAND_SHELL_PADDING_BOTTOM;
const ISLAND_PANEL_VISUAL_HEIGHT = 296;
const ISLAND_PANEL_EXPAND_MS = 300;
const ISLAND_PANEL_COLLAPSE_MS = 280;
const ISLAND_NOTICE_COLLAPSE_MS = 240;
const ISLAND_LAYOUT_SHRINK_SETTLE_MS = 48;
const ISLAND_NOTICE_LAYOUT_SHRINK_SETTLE_MS = 32;
const ISLAND_PANEL_MARGIN_TOP = -12;
const ISLAND_PANEL_PADDING_TOP = 26;
const ISLAND_PANEL_PADDING_BOTTOM = 12;
const ISLAND_NOTICE_MEASURED_BOTTOM_BUFFER = ISLAND_SHELL_PADDING_BOTTOM;
const ISLAND_ACTION_PANEL_HEIGHT = 260;
const ISLAND_MIRRORED_PANEL_HEIGHT = 160;
const ISLAND_CONTENT_PULSE_MS = 380;
const JUMP_FEEDBACK_VISIBLE_MS = 3600;
const ISLAND_AUTO_COLLAPSE_IDLE_MS = 8000;
const ISLAND_AUTO_PEEK_IDLE_MS = 600;
const ISLAND_PEEK_AFTER_COLLAPSE_MS = 40;
const ISLAND_PEEK_REVEAL_HOVER_MS = 80;
const ISLAND_PEEK_DOT_SIZE = 44;
const ISLAND_PEEK_COMPRESS_MS = 320;
const ISLAND_PEEK_REVEAL_TRAVEL_MS = 200;
const ISLAND_PEEK_REVEAL_EXPAND_MS = 220;
const ISLAND_COMPLETION_READY_DELAY_MS = 640;

type IslandPeekPhase = 'visible' | 'compressing' | 'peeking' | 'dropping' | 'expanding';
type IslandPresentationPhase =
  | 'collapsed'
  | 'expanding'
  | 'expanded'
  | 'collapsing'
  | 'permissionNotice'
  | 'peekCompressing'
  | 'peeking'
  | 'peekDropping'
  | 'peekRevealing';

type CollapseReason =
  | 'manual-toggle'
  | 'outside-pointer'
  | 'window-blur'
  | 'settings'
  | 'auto-idle'
  | 'permission-start'
  | 'notification-clear'
  | 'escape';

const islandMotion = {
  micro: { duration: 0.12, ease: [0.16, 1, 0.3, 1] },
  content: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
  widthSpring: { type: 'spring', stiffness: 620, damping: 54, mass: 0.78 },
  peekCompress: { duration: 0.22, ease: [0.32, 0, 0.67, 0] },
  peekReveal: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
  peekWidth: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  extensionSpring: { type: 'spring', stiffness: 460, damping: 42, mass: 0.82 },
  panelGrow: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
  panelShrink: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
  panelContentIn: { duration: 0.18, ease: [0.16, 1, 0.3, 1], delay: 0.07 },
  panelContentOut: { duration: 0.1, ease: [0.4, 0, 0.2, 1] }
} as const;

function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const view = new URLSearchParams(window.location.search).get('view') === 'settings' ? 'settings' : 'island';

  useEffect(() => {
    let mounted = true;
    void window.vibeIsland.getSnapshot().then((next) => {
      if (mounted) setSnapshot(next);
    });
    const unsubscribe = window.vibeIsland.onSnapshot(setSnapshot);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  if (!snapshot) return <div className={`app-shell ${view}`}>{dictionaries['zh-CN'].loading}</div>;
  return view === 'settings' ? <SettingsView snapshot={snapshot} /> : <IslandView snapshot={snapshot} />;
}

function IslandView({ snapshot }: { snapshot: AppSnapshot }): JSX.Element {
  const [presentationPhase, setPresentationPhase] = useState<IslandPresentationPhase>('collapsed');
  const [retainedPermissionNotice, setRetainedPermissionNotice] = useState<PermissionRequest | null>(null);
  const [retainedMirroredPrompt, setRetainedMirroredPrompt] = useState<NormalizedEvent | null>(null);
  const [permissionNoticeClosing, setPermissionNoticeClosing] = useState(false);
  const [measuredNoticeCanvasHeight, setMeasuredNoticeCanvasHeight] = useState<number | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const islandLayoutRef = useRef({ width: ISLAND_CANVAS_WIDTH, height: ISLAND_BAR_WINDOW_HEIGHT });
  const layoutTimerRef = useRef<number | null>(null);
  const presentationTimerRef = useRef<number | null>(null);
  const autoCollapseTimerRef = useRef<number | null>(null);
  const autoPeekTimerRef = useRef<number | null>(null);
  const peekRevealTimerRef = useRef<number | null>(null);
  const peekTransitionTimerRef = useRef<number | null>(null);
  const contentPulseTimerRef = useRef<number | null>(null);
  const jumpStatusTimerRef = useRef<number | null>(null);
  const completionReadyTimerRef = useRef<number | null>(null);
  const previousTextKeyRef = useRef<string | null>(null);
  const previousPermissionIdRef = useRef<string | undefined>(undefined);
  const previousNotificationIdRef = useRef<string | null>(null);
  const lastActivityAtRef = useRef(Date.now());
  const interactionHoldRef = useRef(false);
  const peekingRef = useRef(false);
  const presentationPhaseRef = useRef<IslandPresentationPhase>('collapsed');
  const permissionRef = useRef<PermissionRequest | undefined>(undefined);
  const mirroredPromptRef = useRef<NormalizedEvent | null>(null);
  const idlePeekEligibleRef = useRef(false);
  const lastPointerPointRef = useRef<{ x: number; y: number } | null>(null);
  const [contentChanging, setContentChanging] = useState(false);
  const [jumpStatus, setJumpStatus] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [completionAnimationReady, setCompletionAnimationReady] = useState(false);
  const dictionary = getDictionary(snapshot.config.language);
  const visibleSessions = snapshot.sessions.filter((session) => !isLowSignalSession(session));
  const active = visibleSessions[0];
  const jumpTarget = active ? { sessionId: active.id, workspace: active.workspace } : undefined;
  const notification = snapshot.notification;
  const permission = snapshot.permissions[0];
  permissionRef.current = permission;
  const displayNotification = getDisplayNotification(notification);
  const mirroredPrompt = permission ? null : getMirroredPromptNotification(displayNotification);
  mirroredPromptRef.current = mirroredPrompt;
  const panelMounted = isPanelPresentationPhase(presentationPhase);
  const panelSettled = presentationPhase === 'expanded';
  const expanded = panelMounted;
  const peekPhase = getPeekPhaseFromPresentation(presentationPhase);
  const peekVisualActive = isPeekPresentationPhase(presentationPhase);
  const visiblePermissionNotice =
    permission ?? (permissionNoticeClosing ? retainedPermissionNotice : null);
  const visibleMirroredPrompt =
    permission || visiblePermissionNotice
      ? null
      : mirroredPrompt ?? (permissionNoticeClosing ? retainedMirroredPrompt : null);
  const shouldRetainNoticeDuringClose =
    !permissionNoticeClosing &&
    presentationPhase === 'permissionNotice' &&
    !permission &&
    !mirroredPrompt &&
    (Boolean(retainedPermissionNotice) || Boolean(retainedMirroredPrompt));
  const effectivePermissionNotice = visiblePermissionNotice ?? (shouldRetainNoticeDuringClose ? retainedPermissionNotice : null);
  const effectiveMirroredPrompt =
    visibleMirroredPrompt ?? (effectivePermissionNotice ? null : shouldRetainNoticeDuringClose ? retainedMirroredPrompt : null);
  const permissionNoticeVisible =
    (presentationPhase === 'permissionNotice' || permissionNoticeClosing || shouldRetainNoticeDuringClose) &&
    (Boolean(effectivePermissionNotice) || Boolean(effectiveMirroredPrompt));
  const tone = getIslandTone(
    effectivePermissionNotice ?? undefined,
    effectiveMirroredPrompt,
    displayNotification,
    active
  );
  const workspaceLabel = active?.title ?? (displayNotification?.workspace ? getWorkspaceName(displayNotification.workspace) : undefined);
  const primaryText = getIslandPrimaryText(
    effectivePermissionNotice ?? undefined,
    effectiveMirroredPrompt,
    displayNotification,
    active,
    workspaceLabel
  );
  const secondaryText = getIslandSecondaryText(
    effectivePermissionNotice ?? undefined,
    effectiveMirroredPrompt,
    displayNotification,
    active
  );
  const islandWidth = estimateIslandWidth(primaryText, secondaryText, effectivePermissionNotice, effectiveMirroredPrompt);
  const islandCardWidth = panelMounted ? ISLAND_VISUAL_MAX_WIDTH : islandWidth;
  const islandVisualWidth =
    presentationPhase === 'peekCompressing' || presentationPhase === 'peeking' || presentationPhase === 'peekDropping'
      ? ISLAND_PEEK_DOT_SIZE
      : islandCardWidth;
  const islandWidthTransition =
    presentationPhase === 'peekCompressing'
      ? islandMotion.peekCompress
      : presentationPhase === 'peekRevealing'
        ? islandMotion.peekReveal
        : islandMotion.widthSpring;
  const textKey =
    effectivePermissionNotice?.id ?? effectiveMirroredPrompt?.id ?? displayNotification?.id ?? `${primaryText}:${secondaryText}`;
  const countdown = getIslandCountdown(effectivePermissionNotice ?? undefined, effectiveMirroredPrompt, displayNotification);
  const islandLayout = getIslandLayout(
    presentationPhase,
    permissionNoticeVisible ? effectivePermissionNotice ?? undefined : undefined,
    permissionNoticeVisible ? effectiveMirroredPrompt : null,
    measuredNoticeCanvasHeight
  );
  const autoPeekEnabled = snapshot.config.autoPeekIsland ?? true;
  const idlePeekEligible =
    autoPeekEnabled &&
    !displayNotification &&
    !permission;
  idlePeekEligibleRef.current = idlePeekEligible;
  const canAutoPeek = idlePeekEligible && presentationPhase === 'collapsed';
  const completionNotificationId = tone === 'completed' ? (displayNotification?.id ?? textKey) : null;
  const completionReady = Boolean(completionNotificationId && completionAnimationReady);
  const visualTone: IslandTone = tone === 'completed' && !completionReady ? 'reply' : tone;
  const animationState = getIslandAnimationState({
    active,
    notification: displayNotification,
    presentationPhase,
    permission: effectivePermissionNotice ?? undefined,
    mirroredPrompt: effectiveMirroredPrompt,
    tone: visualTone
  });
  const statusIconKey = `${visualTone}-${completionReady ? 'ready' : 'pending'}-${
    effectivePermissionNotice?.id ?? effectiveMirroredPrompt?.id ?? displayNotification?.id ?? active?.status ?? 'idle'
  }`;

  const getNoticeTargetPhase = useCallback((): 'collapsed' | 'permissionNotice' => {
    return permissionRef.current || mirroredPromptRef.current ? 'permissionNotice' : 'collapsed';
  }, []);

  async function requestJump(target?: string | { sessionId?: string; workspace?: string }): Promise<void> {
    setJumpStatus({ tone: 'success', message: dictionary.labels.jumping });
    if (jumpStatusTimerRef.current) {
      window.clearTimeout(jumpStatusTimerRef.current);
      jumpStatusTimerRef.current = null;
    }
    try {
      const result = await withTimeout(window.vibeIsland.jumpWorkspace(target), 5000, {
        ok: false,
        message: dictionary.labels.jumpTimeout
      });
      setJumpStatus({
        tone: result.ok ? 'success' : 'error',
        message: result.message
      });
      jumpStatusTimerRef.current = window.setTimeout(() => {
        setJumpStatus(null);
        jumpStatusTimerRef.current = null;
      }, JUMP_FEEDBACK_VISIBLE_MS);
    } catch (error) {
      setJumpStatus({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
      jumpStatusTimerRef.current = window.setTimeout(() => {
        setJumpStatus(null);
        jumpStatusTimerRef.current = null;
      }, JUMP_FEEDBACK_VISIBLE_MS);
    }
  }

  const setPresentationPhaseState = useCallback((phase: IslandPresentationPhase) => {
    presentationPhaseRef.current = phase;
    setPresentationPhase(phase);
  }, []);

  const clearPresentationTimer = useCallback(() => {
    if (presentationTimerRef.current) {
      window.clearTimeout(presentationTimerRef.current);
      presentationTimerRef.current = null;
    }
  }, []);

  const clearAutoCollapseTimer = useCallback(() => {
    if (autoCollapseTimerRef.current) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  }, []);

  const clearAutoPeekTimer = useCallback(() => {
    if (autoPeekTimerRef.current) {
      window.clearTimeout(autoPeekTimerRef.current);
      autoPeekTimerRef.current = null;
    }
  }, []);

  const clearPeekRevealTimer = useCallback(() => {
    if (peekRevealTimerRef.current) {
      window.clearTimeout(peekRevealTimerRef.current);
      peekRevealTimerRef.current = null;
    }
  }, []);

  const clearPeekTransitionTimer = useCallback(() => {
    if (peekTransitionTimerRef.current) {
      window.clearTimeout(peekTransitionTimerRef.current);
      peekTransitionTimerRef.current = null;
    }
  }, []);

  const clearCompletionReadyTimer = useCallback(() => {
    if (completionReadyTimerRef.current) {
      window.clearTimeout(completionReadyTimerRef.current);
      completionReadyTimerRef.current = null;
    }
  }, []);

  const setIslandPeekingState = useCallback(
    (next: boolean, options?: { hovered?: boolean }) => {
      const hovered = Boolean(options?.hovered);

      if (next) {
        clearPeekTransitionTimer();
        if (peekingRef.current || presentationPhaseRef.current !== 'collapsed') return;
        setPresentationPhaseState('peekCompressing');
        peekTransitionTimerRef.current = window.setTimeout(() => {
          peekTransitionTimerRef.current = null;
          if (presentationPhaseRef.current !== 'peekCompressing') return;
          peekingRef.current = true;
          setPresentationPhaseState('peeking');
          void window.vibeIsland.setIslandPeeking(true);
        }, ISLAND_PEEK_COMPRESS_MS);
        return;
      }

      if (presentationPhaseRef.current === 'peekDropping' || presentationPhaseRef.current === 'peekRevealing') {
        if (hovered) interactionHoldRef.current = true;
        return;
      }

      clearPeekTransitionTimer();

      if (presentationPhaseRef.current === 'peekCompressing') {
        setPresentationPhaseState(getNoticeTargetPhase());
        return;
      }

      if (!peekingRef.current && !isPeekPresentationPhase(presentationPhaseRef.current)) {
        if (hovered) void window.vibeIsland.setIslandHovered(true);
        return;
      }

      setPresentationPhaseState('peekDropping');
      void window.vibeIsland.setIslandPeeking(false);
      peekTransitionTimerRef.current = window.setTimeout(() => {
        if (presentationPhaseRef.current !== 'peekDropping') {
          peekTransitionTimerRef.current = null;
          return;
        }
        setPresentationPhaseState('peekRevealing');
        peekTransitionTimerRef.current = window.setTimeout(() => {
          peekTransitionTimerRef.current = null;
          peekingRef.current = false;
          setPresentationPhaseState(getNoticeTargetPhase());
          const stillHovered = hovered && interactionHoldRef.current;
          if (stillHovered) void window.vibeIsland.setIslandHovered(true);
          if (!stillHovered && idlePeekEligibleRef.current && !interactionHoldRef.current) {
            clearAutoPeekTimer();
            autoPeekTimerRef.current = window.setTimeout(() => {
              autoPeekTimerRef.current = null;
              if (!interactionHoldRef.current && presentationPhaseRef.current === 'collapsed') setIslandPeekingState(true);
            }, ISLAND_AUTO_PEEK_IDLE_MS);
          }
        }, ISLAND_PEEK_REVEAL_EXPAND_MS);
      }, ISLAND_PEEK_REVEAL_TRAVEL_MS);
    },
    [clearAutoPeekTimer, clearPeekTransitionTimer, getNoticeTargetPhase, setPresentationPhaseState]
  );

  const resetAutoPeekTimer = useCallback(() => {
    clearAutoPeekTimer();
    if (!canAutoPeek || interactionHoldRef.current || peekingRef.current || presentationPhaseRef.current !== 'collapsed') {
      return;
    }
    autoPeekTimerRef.current = window.setTimeout(() => {
      autoPeekTimerRef.current = null;
      if (!interactionHoldRef.current) setIslandPeekingState(true);
    }, ISLAND_AUTO_PEEK_IDLE_MS);
  }, [canAutoPeek, clearAutoPeekTimer, setIslandPeekingState]);

  const revealFromPeek = useCallback(
    (hovered = false) => {
      clearAutoPeekTimer();
      clearPeekRevealTimer();
      if (!peekingRef.current && !isPeekPresentationPhase(presentationPhaseRef.current)) {
        if (hovered) void window.vibeIsland.setIslandHovered(true);
        return;
      }
      setIslandPeekingState(false, { hovered });
    },
    [clearAutoPeekTimer, clearPeekRevealTimer, setIslandPeekingState]
  );

  const restoreIslandBar = useCallback(() => {
    if (!peekingRef.current && !isPeekPresentationPhase(presentationPhaseRef.current)) return;
    clearAutoPeekTimer();
    clearPeekRevealTimer();
    clearPeekTransitionTimer();
    peekingRef.current = false;
    interactionHoldRef.current = false;
    const nextPhase = getNoticeTargetPhase();
    if (presentationPhaseRef.current !== nextPhase) setPresentationPhaseState(nextPhase);
    void window.vibeIsland.setIslandPeeking(false);
    void window.vibeIsland.setIslandHovered(false);
  }, [
    clearAutoPeekTimer,
    clearPeekRevealTimer,
    clearPeekTransitionTimer,
    getNoticeTargetPhase,
    setPresentationPhaseState
  ]);

  const armPeekReveal = useCallback(
    (x: number, y: number) => {
      if (!peekingRef.current) return;
      if (presentationPhaseRef.current !== 'peeking') return;
      if (!isPointerInsideElement(barRef.current, x, y)) {
        clearPeekRevealTimer();
        return;
      }
      if (peekRevealTimerRef.current) return;
      peekRevealTimerRef.current = window.setTimeout(() => {
        peekRevealTimerRef.current = null;
        if (isPointerInsideElement(barRef.current, x, y)) revealFromPeek(true);
      }, ISLAND_PEEK_REVEAL_HOVER_MS);
    },
    [clearPeekRevealTimer, revealFromPeek]
  );

  const syncHoverAfterCollapse = useCallback(() => {
    window.setTimeout(() => {
      const point = lastPointerPointRef.current;
      void window.vibeIsland.setIslandHovered(
        point ? isPointerInsideElement(barRef.current, point.x, point.y) : false
      );
    }, 0);
  }, []);

  const finishPanelCollapse = useCallback(() => {
    presentationTimerRef.current = null;
    setPresentationPhaseState(getNoticeTargetPhase());
    void window.vibeIsland.setExpanded(false).then(() => {
      syncHoverAfterCollapse();
      const canPeekAfterCollapse =
        (snapshot.config.autoPeekIsland ?? true) &&
        !displayNotification &&
        !permissionRef.current &&
        !mirroredPromptRef.current;
      if (!canPeekAfterCollapse || interactionHoldRef.current) return;
      window.setTimeout(() => {
        if (presentationPhaseRef.current === 'collapsed' && !interactionHoldRef.current) {
          setIslandPeekingState(true);
        }
      }, ISLAND_PEEK_AFTER_COLLAPSE_MS);
    });
  }, [
    displayNotification,
    getNoticeTargetPhase,
    setIslandPeekingState,
    setPresentationPhaseState,
    snapshot.config.autoPeekIsland,
    syncHoverAfterCollapse
  ]);

  const startExpandSequence = useCallback(
    (options?: { notifyMain?: boolean }) => {
      const currentPhase = presentationPhaseRef.current;
      if (currentPhase === 'expanded' || currentPhase === 'expanding') return;

      clearAutoCollapseTimer();
      clearPresentationTimer();
      revealFromPeek(false);
      lastActivityAtRef.current = Date.now();
      setPresentationPhaseState('expanding');
      void window.vibeIsland.setIslandLayout({ width: ISLAND_CANVAS_WIDTH, height: ISLAND_PANEL_WINDOW_HEIGHT });
      if (options?.notifyMain !== false) void window.vibeIsland.setExpanded(true);

      presentationTimerRef.current = window.setTimeout(() => {
        presentationTimerRef.current = null;
        if (presentationPhaseRef.current === 'expanding') {
          setPresentationPhaseState('expanded');
        }
      }, ISLAND_PANEL_EXPAND_MS);
    },
    [clearAutoCollapseTimer, clearPresentationTimer, revealFromPeek, setPresentationPhaseState]
  );

  const requestCollapse = useCallback(
    async (_reason: CollapseReason) => {
      clearAutoCollapseTimer();
      const currentPhase = presentationPhaseRef.current;
      if (currentPhase === 'collapsing') {
        await new Promise<void>((resolve) => window.setTimeout(resolve, ISLAND_PANEL_COLLAPSE_MS));
        return;
      }

      revealFromPeek(false);
      if (!isPanelPresentationPhase(currentPhase)) {
        setPresentationPhaseState(getNoticeTargetPhase());
        await window.vibeIsland.setExpanded(false);
        syncHoverAfterCollapse();
        return;
      }

      clearPresentationTimer();
      setPresentationPhaseState('collapsing');
      presentationTimerRef.current = window.setTimeout(finishPanelCollapse, ISLAND_PANEL_COLLAPSE_MS);
      await new Promise<void>((resolve) => window.setTimeout(resolve, ISLAND_PANEL_COLLAPSE_MS));
    },
    [
      clearAutoCollapseTimer,
      clearPresentationTimer,
      finishPanelCollapse,
      getNoticeTargetPhase,
      revealFromPeek,
      setPresentationPhaseState,
      syncHoverAfterCollapse
    ]
  );

  const resetAutoCollapseTimer = useCallback(() => {
    clearAutoCollapseTimer();
    if (presentationPhaseRef.current !== 'expanded' || interactionHoldRef.current) return;
    autoCollapseTimerRef.current = window.setTimeout(() => {
      void requestCollapse('auto-idle');
    }, ISLAND_AUTO_COLLAPSE_IDLE_MS);
  }, [clearAutoCollapseTimer, requestCollapse]);

  const markIslandActivity = useCallback(() => {
    lastActivityAtRef.current = Date.now();
    if (peekingRef.current) revealFromPeek(true);
    resetAutoCollapseTimer();
    resetAutoPeekTimer();
  }, [resetAutoCollapseTimer, resetAutoPeekTimer, revealFromPeek]);

  const setInteractionHold = useCallback(
    (held: boolean) => {
      interactionHoldRef.current = held;
      lastActivityAtRef.current = Date.now();
      if (held) {
        clearAutoCollapseTimer();
        clearAutoPeekTimer();
        if (peekingRef.current) revealFromPeek(true);
        return;
      }
      resetAutoCollapseTimer();
      resetAutoPeekTimer();
    },
    [clearAutoCollapseTimer, clearAutoPeekTimer, resetAutoCollapseTimer, resetAutoPeekTimer, revealFromPeek]
  );

  useEffect(() => {
    const unsubscribe = window.vibeIsland.onExpanded((next) => {
      if (!next) {
        clearAutoCollapseTimer();
        if (isPanelPresentationPhase(presentationPhaseRef.current)) {
          void requestCollapse('window-blur');
          return;
        }
        setPresentationPhaseState(getNoticeTargetPhase());
        syncHoverAfterCollapse();
        return;
      }
      startExpandSequence({ notifyMain: false });
    });
    return unsubscribe;
  }, [
    clearAutoCollapseTimer,
    getNoticeTargetPhase,
    requestCollapse,
    setPresentationPhaseState,
    startExpandSequence,
    syncHoverAfterCollapse
  ]);

  useEffect(() => {
    return window.vibeIsland.onIslandShow(restoreIslandBar);
  }, [restoreIslandBar]);

  useEffect(() => {
    return () => {
      if (presentationTimerRef.current) window.clearTimeout(presentationTimerRef.current);
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
      if (autoCollapseTimerRef.current) window.clearTimeout(autoCollapseTimerRef.current);
      if (autoPeekTimerRef.current) window.clearTimeout(autoPeekTimerRef.current);
      if (peekRevealTimerRef.current) window.clearTimeout(peekRevealTimerRef.current);
      if (peekTransitionTimerRef.current) window.clearTimeout(peekTransitionTimerRef.current);
      if (contentPulseTimerRef.current) window.clearTimeout(contentPulseTimerRef.current);
      if (jumpStatusTimerRef.current) window.clearTimeout(jumpStatusTimerRef.current);
      if (completionReadyTimerRef.current) window.clearTimeout(completionReadyTimerRef.current);
      void window.vibeIsland.setIslandPeeking(false);
    };
  }, []);

  useEffect(() => {
    clearCompletionReadyTimer();
    if (!completionNotificationId) {
      setCompletionAnimationReady(false);
      return undefined;
    }

    setCompletionAnimationReady(false);
    completionReadyTimerRef.current = window.setTimeout(() => {
      completionReadyTimerRef.current = null;
      setCompletionAnimationReady(true);
    }, ISLAND_COMPLETION_READY_DELAY_MS);

    return clearCompletionReadyTimer;
  }, [clearCompletionReadyTimer, completionNotificationId]);

  useEffect(() => {
    if (permission) {
      setRetainedPermissionNotice(permission);
      setRetainedMirroredPrompt(null);
      setPermissionNoticeClosing(false);
      return;
    }

    if (mirroredPrompt) {
      setRetainedPermissionNotice(null);
      setRetainedMirroredPrompt(mirroredPrompt);
      setPermissionNoticeClosing(false);
      return;
    }

    if (presentationPhase === 'collapsed') {
      setRetainedPermissionNotice(null);
      setRetainedMirroredPrompt(null);
      setPermissionNoticeClosing(false);
    }
  }, [mirroredPrompt, permission, presentationPhase]);

  useLayoutEffect(() => {
    if (!permissionNoticeVisible || panelMounted || peekVisualActive) {
      setMeasuredNoticeCanvasHeight(null);
      return undefined;
    }

    const shell = shellRef.current;
    const card = cardRef.current;
    if (!shell || !card) return undefined;

    let frameId = 0;
    let observer: ResizeObserver | null = null;

    const measure = (): void => {
      const shellRect = shell.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const nextHeight = Math.max(
        ISLAND_BAR_WINDOW_HEIGHT,
        Math.ceil(cardRect.bottom - shellRect.top + ISLAND_NOTICE_MEASURED_BOTTOM_BUFFER)
      );
      setMeasuredNoticeCanvasHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    const scheduleMeasure = (): void => {
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        measure();
      });
    };

    scheduleMeasure();
    observer = new ResizeObserver(scheduleMeasure);
    observer.observe(card);
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [panelMounted, peekVisualActive, permissionNoticeVisible, visibleMirroredPrompt?.id, visiblePermissionNotice?.id]);

  useEffect(() => {
    if (previousTextKeyRef.current === null) {
      previousTextKeyRef.current = textKey;
      return undefined;
    }
    if (previousTextKeyRef.current === textKey) return undefined;
    previousTextKeyRef.current = textKey;

    setContentChanging(true);
    if (contentPulseTimerRef.current) window.clearTimeout(contentPulseTimerRef.current);
    contentPulseTimerRef.current = window.setTimeout(() => {
      setContentChanging(false);
      contentPulseTimerRef.current = null;
    }, ISLAND_CONTENT_PULSE_MS);
    return undefined;
  }, [textKey]);

  useEffect(() => {
    const current = islandLayoutRef.current;
    if (islandLayout.width === current.width && islandLayout.height === current.height) {
      return undefined;
    }
    const shouldGrow = islandLayout.width > current.width || islandLayout.height > current.height;

    if (layoutTimerRef.current) {
      window.clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = null;
    }

    const syncLayout = (): void => {
      islandLayoutRef.current = islandLayout;
      void window.vibeIsland.setIslandLayout(islandLayout);
    };

    if (shouldGrow) {
      syncLayout();
      return undefined;
    }

    layoutTimerRef.current = window.setTimeout(
      syncLayout,
      getIslandLayoutShrinkDelay(current.height, islandLayout.height)
    );
    return () => {
      if (layoutTimerRef.current) {
        window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = null;
      }
    };
  }, [islandLayout.width, islandLayout.height]);

  useEffect(() => {
    if (!idlePeekEligible || interactionHoldRef.current) {
      clearAutoPeekTimer();
      revealFromPeek(false);
      return undefined;
    }

    if (!canAutoPeek) return undefined;

    resetAutoPeekTimer();

    return clearAutoPeekTimer;
  }, [canAutoPeek, clearAutoPeekTimer, idlePeekEligible, presentationPhase, resetAutoPeekTimer, revealFromPeek]);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
      if (!expanded && !peekingRef.current) {
        const insideBar = isPointerInsideElement(barRef.current, event.clientX, event.clientY);
        interactionHoldRef.current = insideBar;
        void window.vibeIsland.setIslandHovered(insideBar);
      }
      armPeekReveal(event.clientX, event.clientY);
    }

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [armPeekReveal, expanded]);

  useEffect(() => {
    if (!panelSettled) {
      clearAutoCollapseTimer();
      return undefined;
    }

    lastActivityAtRef.current = Date.now();
    resetAutoCollapseTimer();
    return clearAutoCollapseTimer;
  }, [clearAutoCollapseTimer, panelSettled, resetAutoCollapseTimer]);

  useEffect(() => {
    if (!expanded) return undefined;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (cardRef.current?.contains(target)) return;
      void requestCollapse('outside-pointer');
    }

    function handleWindowBlur(): void {
      void requestCollapse('window-blur');
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        void requestCollapse('escape');
        return;
      }
      markIslandActivity();
    }

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [expanded, markIslandActivity, requestCollapse]);

  useEffect(() => {
    const permissionId = permission?.id;
    if (permissionId && previousPermissionIdRef.current !== permissionId) {
      setJumpStatus(null);
      if (jumpStatusTimerRef.current) {
        window.clearTimeout(jumpStatusTimerRef.current);
        jumpStatusTimerRef.current = null;
      }
      void requestCollapse('permission-start');
    }
    previousPermissionIdRef.current = permissionId;
  }, [permission?.id, requestCollapse]);

  useEffect(() => {
    const hasActionableNotice = Boolean(permission || mirroredPrompt);
    if (hasActionableNotice) {
      const currentPhase = presentationPhaseRef.current;
      setPermissionNoticeClosing(false);
      if (
        currentPhase === 'permissionNotice' ||
        currentPhase === 'expanding' ||
        currentPhase === 'expanded'
      ) {
        clearPresentationTimer();
        return undefined;
      }
      if (currentPhase === 'collapsing') return undefined;
      if (isPeekPresentationPhase(currentPhase)) {
        restoreIslandBar();
        return undefined;
      }
      if (currentPhase === 'collapsed') {
        clearPresentationTimer();
        setPresentationPhaseState('permissionNotice');
        return undefined;
      }
      return undefined;
    }

    if (!hasActionableNotice && presentationPhaseRef.current === 'permissionNotice' && !permissionNoticeClosing) {
      setPermissionNoticeClosing(true);
      clearPresentationTimer();
      presentationTimerRef.current = window.setTimeout(() => {
        presentationTimerRef.current = null;
        if (!permissionRef.current && presentationPhaseRef.current === 'permissionNotice') {
          setRetainedPermissionNotice(null);
          setRetainedMirroredPrompt(null);
          setPermissionNoticeClosing(false);
          setPresentationPhaseState('collapsed');
        }
      }, ISLAND_NOTICE_COLLAPSE_MS);
    }

    return undefined;
  }, [
    clearPresentationTimer,
    mirroredPrompt,
    permission,
    permissionNoticeClosing,
    requestCollapse,
    restoreIslandBar,
    setPresentationPhaseState
  ]);

  useEffect(() => {
    const notificationId = displayNotification?.id ?? null;
    const previousNotificationId = previousNotificationIdRef.current;
    if (
      previousNotificationId &&
      !notificationId &&
      expanded &&
      !interactionHoldRef.current &&
      Date.now() - lastActivityAtRef.current >= ISLAND_AUTO_COLLAPSE_IDLE_MS
    ) {
      void requestCollapse('notification-clear');
    }
    previousNotificationIdRef.current = notificationId;
  }, [displayNotification?.id, expanded, requestCollapse]);

  async function toggleExpanded(): Promise<void> {
    if (peekingRef.current) {
      revealFromPeek(true);
      return;
    }
    if (presentationPhaseRef.current === 'expanded' || presentationPhaseRef.current === 'expanding') {
      await requestCollapse('manual-toggle');
      return;
    }
    startExpandSequence();
  }

  async function openSettingsFromIsland(): Promise<void> {
    await requestCollapse('settings');
    await window.vibeIsland.openSettings();
  }

  function handleSettingsPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    void openSettingsFromIsland();
  }

  function handleSettingsClick(event: React.MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    void openSettingsFromIsland();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>): void {
    lastPointerPointRef.current = { x: event.clientX, y: event.clientY };
    if (peekingRef.current) {
      armPeekReveal(event.clientX, event.clientY);
      return;
    }
    if (expanded) {
      markIslandActivity();
      return;
    }
    const insideBar = isPointerInsideElement(barRef.current, event.clientX, event.clientY);
    interactionHoldRef.current = insideBar;
    void window.vibeIsland.setIslandHovered(insideBar);
  }

  return (
    <MotionConfig transition={islandMotion.widthSpring}>
      <main
        ref={shellRef}
        className={`island-shell ${peekVisualActive ? 'peeking' : ''}`}
        data-theme-mode={snapshot.config.theme}
        data-accent={snapshot.config.accentTheme}
      >
        <motion.section
          ref={cardRef}
          className={`island-card ${panelMounted ? 'expanded' : 'collapsed'} phase-${presentationPhase} ${
            peekVisualActive ? 'is-peeking' : ''
          } peek-${peekPhase} ${
            contentChanging ? 'is-content-changing' : ''
          } state-${animationState} tone-${visualTone}`}
          animate={{ width: islandVisualWidth }}
          transition={islandWidthTransition}
          onMouseEnter={(event) => {
            const insideBar = isPointerInsideElement(barRef.current, event.clientX, event.clientY);
            setInteractionHold(insideBar);
            void window.vibeIsland.setIslandHovered(insideBar);
          }}
          onMouseLeave={() => {
            setInteractionHold(false);
            void window.vibeIsland.setIslandHovered(false);
          }}
          onPointerDownCapture={() => markIslandActivity()}
          onFocusCapture={() => setInteractionHold(true)}
          onBlurCapture={(event) => {
            if (cardRef.current?.contains(event.relatedTarget)) return;
            setInteractionHold(false);
          }}
          onPointerMove={handlePointerMove}
        >
          <motion.button
            ref={barRef}
            className="island-bar"
            type="button"
            onClick={toggleExpanded}
            aria-label="展开或收起 Vibe Island"
            animate={{ y: animationState === 'permissionNotice' ? 1 : 0 }}
            transition={islandMotion.micro}
          >
            <span className="surface-chrome" aria-hidden="true" />
            {animationState === 'idle' ? <IslandIdleLight width={islandVisualWidth} /> : null}
            {countdown ? (
              <IslandCountdown
                key={countdown.key}
                durationMs={countdown.durationMs}
                tone={visualTone}
                width={islandVisualWidth}
              />
            ) : null}
            <div className="island-content-clip">
              <div className="island-content">
                <span
                  className={`agent-dot ${
                    effectivePermissionNotice?.agent ?? effectiveMirroredPrompt?.agent ?? displayNotification?.agent ?? active?.agent ?? 'unknown'
                  }`}
                />
                <RollingText value={primaryText} textKey={`primary-${textKey}`} className="island-primary" delay={0.06} />
                <span className="island-trailing">
                  <RollingText
                    value={secondaryText}
                    textKey={`secondary-${textKey}`}
                    className="island-secondary"
                    delay={0.12}
                  />
                  <span className="status-slot">
                    <span className="status-slot-inner" key={statusIconKey}>
                      {renderIslandStatusIcon(visualTone, completionReady)}
                    </span>
                  </span>
                  <span className="toggle-slot" aria-hidden="true">
                    <ChevronDown className="toggle-chevron" size={16} />
                  </span>
                </span>
              </div>
            </div>
          </motion.button>

          {!panelMounted ? (
            <AnimatePresence initial={false}>
              {permissionNoticeVisible && effectivePermissionNotice ? (
                <PermissionNotice
                  request={effectivePermissionNotice}
                  closing={permissionNoticeClosing}
                  key={`permission-notice-${effectivePermissionNotice.id}`}
                />
              ) : permissionNoticeVisible && effectiveMirroredPrompt ? (
                <MirroredPermissionNotice
                  notification={effectiveMirroredPrompt}
                  closing={permissionNoticeClosing}
                  key={`mirrored-permission-notice-${effectiveMirroredPrompt.id}`}
                />
              ) : null}
            </AnimatePresence>
          ) : null}

          <AnimatePresence initial={false}>
            {panelMounted ? (
              <motion.section
                key="island-panel"
                className="island-panel"
                aria-label="Vibe Island 控制面板"
                initial={{
                  opacity: 0,
                  height: 0,
                  y: -10,
                  marginTop: 0,
                  paddingTop: 0,
                  paddingBottom: 0
                }}
                animate={{
                  opacity: presentationPhase === 'collapsing' ? 0 : 1,
                  height: presentationPhase === 'collapsing' ? 0 : ISLAND_PANEL_VISUAL_HEIGHT,
                  y: presentationPhase === 'collapsing' ? -8 : 0,
                  marginTop: presentationPhase === 'collapsing' ? 0 : ISLAND_PANEL_MARGIN_TOP,
                  paddingTop: presentationPhase === 'collapsing' ? 0 : ISLAND_PANEL_PADDING_TOP,
                  paddingBottom: presentationPhase === 'collapsing' ? 0 : ISLAND_PANEL_PADDING_BOTTOM
                }}
                exit={{ opacity: 0, height: 0, y: -8, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
                transition={{
                  height: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow,
                  opacity:
                    presentationPhase === 'collapsing' ? islandMotion.panelContentOut : islandMotion.panelContentIn,
                  y: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow,
                  marginTop: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow,
                  paddingTop: presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow,
                  paddingBottom:
                    presentationPhase === 'collapsing' ? islandMotion.panelShrink : islandMotion.panelGrow
                }}
              >
                <motion.div
                  className={`island-panel-content ${permission ? 'permission-mode' : ''}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{
                    opacity: presentationPhase === 'collapsing' ? 0 : 1,
                    y: presentationPhase === 'collapsing' ? -6 : 0
                  }}
                  transition={
                    presentationPhase === 'collapsing' ? islandMotion.panelContentOut : islandMotion.panelContentIn
                  }
                >
                  {permission ? (
                    <div className="permission-detail-host">
                      <PermissionPanel request={permission} />
                    </div>
                  ) : null}
                  {!permission ? <SessionStrip sessions={visibleSessions} onJump={requestJump} /> : null}
                  {!permission ? <EventList events={snapshot.events.slice(0, 2)} /> : null}
                  {!permission && jumpStatus ? <div className={`jump-feedback ${jumpStatus.tone}`}>{jumpStatus.message}</div> : null}
                  {!permission ? (
                    <div className="panel-actions">
                      <button
                        className="icon-button label-button"
                        type="button"
                        onPointerDown={handleSettingsPointerDown}
                        onClick={handleSettingsClick}
                      >
                        <Settings size={16} />
                        设置
                      </button>
                      <button
                        className="icon-button label-button"
                        type="button"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.stopPropagation();
                          void requestJump(jumpTarget);
                        }}
                      >
                        <ExternalLink size={16} />
                        跳转
                      </button>
                    </div>
                  ) : null}
                </motion.div>
              </motion.section>
            ) : null}
          </AnimatePresence>
        </motion.section>
      </main>
    </MotionConfig>
  );
}

function IslandIdleLight({ width }: { width: number }): JSX.Element {
  const safeWidth = Math.max(44, width);
  const path = buildCapsulePath(safeWidth, 1.5);

  return (
    <span className="island-idle-light" aria-hidden="true">
      <svg viewBox={`0 0 ${safeWidth} 44`} preserveAspectRatio="none" focusable="false">
        <path className="idle-light-track" d={path} pathLength="100" />
        <path className="idle-light-progress" d={path} pathLength="100" />
      </svg>
    </span>
  );
}

function IslandCountdown({
  durationMs,
  tone,
  width
}: {
  durationMs: number;
  tone: IslandTone;
  width: number;
}): JSX.Element {
  const style = {
    '--countdown-duration': `${Math.max(120, durationMs)}ms`
  } as CSSProperties;
  const safeWidth = Math.max(44, width);
  const path = buildCapsulePath(safeWidth);

  return (
    <span className={`island-countdown countdown-${tone}`} aria-hidden="true" style={style}>
      <svg viewBox={`0 0 ${safeWidth} 44`} preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={`countdown-gradient-${tone}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="34%" stopColor="#facc15" />
            <stop offset="68%" stopColor="var(--island-accent)" />
            <stop offset="100%" stopColor="var(--island-accent-bright)" />
          </linearGradient>
        </defs>
        <path className="countdown-track" d={path} pathLength="100" />
        <path
          className="countdown-progress"
          d={path}
          pathLength="100"
          stroke={`url(#countdown-gradient-${tone})`}
        />
      </svg>
    </span>
  );
}

function buildCapsulePath(width: number, inset = 1): string {
  const radius = 22 - inset;
  const centerY = 22;
  const top = inset;
  const bottom = 44 - inset;
  const left = inset;
  const right = width - inset;
  const leftArcEnd = left + radius;
  const rightArcStart = right - radius;
  const topCenter = width / 2;

  return [
    `M ${topCenter} ${top}`,
    `H ${rightArcStart}`,
    `A ${radius} ${radius} 0 0 1 ${right} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${rightArcStart} ${bottom}`,
    `H ${leftArcEnd}`,
    `A ${radius} ${radius} 0 0 1 ${left} ${centerY}`,
    `A ${radius} ${radius} 0 0 1 ${leftArcEnd} ${top}`,
    `H ${topCenter}`
  ].join(' ');
}

function PermissionNotice({ request, closing = false }: { request: PermissionRequest; closing?: boolean }): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [busyDecision, setBusyDecision] = useState<PermissionDecision | null>(null);
  const respondInFlightRef = useRef(false);
  const canSendTypedAnswer = request.kind === 'question' && answer.trim().length > 0;

  useEffect(() => {
    setAnswer('');
    setBusyDecision(null);
    respondInFlightRef.current = false;
  }, [request.id]);

  async function respond(decision: PermissionDecision, selectedAnswer?: string): Promise<void> {
    if (respondInFlightRef.current) return;
    respondInFlightRef.current = true;
    setBusyDecision(decision);
    try {
      await window.vibeIsland.respondPermission({
        id: request.id,
        decision,
        decidedAt: new Date().toISOString(),
        answer: selectedAnswer?.trim() || (decision === 'answer' ? answer.trim() : undefined),
        scope: decision === 'denyForSession' ? 'session' : 'request'
      });
    } finally {
      respondInFlightRef.current = false;
      setBusyDecision(null);
    }
  }

  return (
    <motion.section
      className={`island-panel island-inline-panel island-inline-permission risk-${request.risk} ${
        closing ? 'is-closing' : ''
      }`}
      aria-label={request.kind === 'question' ? '需要回答提示' : '需要权限提示'}
      initial={{ opacity: 0, height: 0, y: -10, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      animate={{
        opacity: closing ? 0 : 1,
        height: closing ? 0 : ISLAND_ACTION_PANEL_HEIGHT,
        y: closing ? -8 : 0,
        marginTop: closing ? 0 : ISLAND_PANEL_MARGIN_TOP,
        paddingTop: closing ? 0 : ISLAND_PANEL_PADDING_TOP,
        paddingBottom: closing ? 0 : ISLAND_PANEL_PADDING_BOTTOM
      }}
      exit={{ opacity: 0, height: 0, y: -8, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{
        height: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        opacity: closing ? islandMotion.panelContentOut : islandMotion.panelContentIn,
        y: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        marginTop: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        paddingTop: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        paddingBottom: closing ? islandMotion.panelShrink : islandMotion.panelGrow
      }}
    >
      <motion.div
        className="island-panel-content island-inline-panel-content"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: closing ? 0 : 1, y: closing ? -6 : 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={closing ? islandMotion.panelContentOut : islandMotion.panelContentIn}
      >
        <section className="permission-summary" aria-label={request.kind === 'question' ? '需要回答提示' : '需要权限提示'}>
          <div className="permission-summary-header">
            <div className="notice-title">
              <span>{getActionableKindLabel(request)}</span>
              <strong>{agentLabels[request.agent]}</strong>
              <em>{formatRisk(request.risk)}</em>
            </div>
          </div>
          <div className="permission-summary-scroll">
            <div className="permission-summary-copy">
            <p>{request.action}</p>
            {request.prompt ? <p className="notice-prompt">{request.prompt}</p> : null}
            {request.command ? <code>{request.command}</code> : null}
            </div>
          </div>
          <div className="permission-meta">
            <span>{request.kind === 'question' ? '等待输入' : '等待审批'}，{Math.ceil(getPermissionNoticeTimeoutMs(request.timeoutMs) / 1000)} 秒后超时</span>
            <strong>{formatRisk(request.risk)}</strong>
          </div>
          <InlinePermissionActions
            request={request}
            compact
            answer={answer}
            busyDecision={busyDecision}
            canSendTypedAnswer={canSendTypedAnswer}
            onAnswerChange={setAnswer}
            onRespond={respond}
          />
        </section>
      </motion.div>
    </motion.section>
  );
}

function MirroredPermissionNotice({
  notification,
  closing = false
}: {
  notification: NormalizedEvent;
  closing?: boolean;
}): JSX.Element {
  const tool = getMirroredPermissionTool(notification);
  const detail = notification.message ?? '请回到 Claude 会话处理权限确认。';

  return (
    <motion.section
      className={`island-panel island-inline-panel island-inline-permission mirrored-permission-notice risk-medium ${
        closing ? 'is-closing' : ''
      }`}
      aria-label="Claude 权限提示"
      initial={{ opacity: 0, height: 0, y: -10, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      animate={{
        opacity: closing ? 0 : 1,
        height: closing ? 0 : ISLAND_MIRRORED_PANEL_HEIGHT,
        y: closing ? -8 : 0,
        marginTop: closing ? 0 : ISLAND_PANEL_MARGIN_TOP,
        paddingTop: closing ? 0 : ISLAND_PANEL_PADDING_TOP,
        paddingBottom: closing ? 0 : ISLAND_PANEL_PADDING_BOTTOM
      }}
      exit={{ opacity: 0, height: 0, y: -8, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{
        height: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        opacity: closing ? islandMotion.panelContentOut : islandMotion.panelContentIn,
        y: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        marginTop: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        paddingTop: closing ? islandMotion.panelShrink : islandMotion.panelGrow,
        paddingBottom: closing ? islandMotion.panelShrink : islandMotion.panelGrow
      }}
    >
      <motion.div
        className="island-panel-content island-inline-panel-content"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: closing ? 0 : 1, y: closing ? -6 : 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={closing ? islandMotion.panelContentOut : islandMotion.panelContentIn}
      >
        <div className="inline-panel-header">
          <span className="inline-panel-signal" aria-hidden="true" />
          <div className="inline-panel-title">
            <strong>{tool ? `Claude 请求使用 ${tool}` : 'Claude 请求权限'}</strong>
            <span>{agentLabels[notification.agent]}</span>
          </div>
        </div>
        <section className="permission-panel inline-panel-static" aria-label="Claude 权限提示">
          <div>
            <div className="section-kicker">Claude 权限镜像提示</div>
            <h2>{tool ? `Claude 请求使用 ${tool}` : 'Claude 请求权限'}</h2>
            <p>{detail}</p>
          </div>
        </section>
      </motion.div>
    </motion.section>
  );
}

function isPointerInsideElement(element: HTMLElement | null, x?: number, y?: number): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const pointX = x ?? window.innerWidth / 2;
  const pointY = y ?? 22;
  return pointX >= rect.left && pointX <= rect.right && pointY >= rect.top && pointY <= rect.bottom;
}

function estimateIslandWidth(
  primaryText: string,
  secondaryText: string,
  permission: PermissionRequest | null,
  mirroredPrompt: NormalizedEvent | null
): number {
  const actionableNotice = Boolean(permission || mirroredPrompt);
  const primaryUnits = measureTextUnits(primaryText);
  const secondaryUnits = measureTextUnits(secondaryText);
  const detailText =
    permission?.prompt ??
    permission?.command ??
    mirroredPrompt?.message ??
    mirroredPrompt?.title ??
    '';
  const detailUnits = Math.min(measureTextUnits(detailText), actionableNotice ? 42 : 20);
  const baseWidth = primaryUnits * 8.4 + Math.min(secondaryUnits, 22) * 6.8 + 124;
  const noticeWidthBoost = actionableNotice ? Math.max(detailUnits * 4.9, 168) : 0;
  const minWidth = actionableNotice ? 420 : 240;
  const maxWidth = actionableNotice ? 528 : 468;
  return Math.max(minWidth, Math.min(maxWidth, Math.round(baseWidth + noticeWidthBoost)));
}

function isPanelPresentationPhase(phase: IslandPresentationPhase): boolean {
  return phase === 'expanding' || phase === 'expanded' || phase === 'collapsing';
}

function isPeekPresentationPhase(phase: IslandPresentationPhase): boolean {
  return phase === 'peekCompressing' || phase === 'peeking' || phase === 'peekDropping' || phase === 'peekRevealing';
}

function getPeekPhaseFromPresentation(phase: IslandPresentationPhase): IslandPeekPhase {
  if (phase === 'peekCompressing') return 'compressing';
  if (phase === 'peeking') return 'peeking';
  if (phase === 'peekDropping') return 'dropping';
  if (phase === 'peekRevealing') return 'expanding';
  return 'visible';
}

function getIslandLayout(
  presentationPhase: IslandPresentationPhase,
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  measuredNoticeCanvasHeight: number | null
): { width: number; height: number } {
  if (isPanelPresentationPhase(presentationPhase)) {
    return { width: ISLAND_CANVAS_WIDTH, height: ISLAND_PANEL_WINDOW_HEIGHT };
  }
  return {
    width: ISLAND_CANVAS_WIDTH,
    height:
      permission || mirroredPrompt
        ? measuredNoticeCanvasHeight ?? estimatePermissionNoticeCanvasHeight(permission, mirroredPrompt)
        : ISLAND_BAR_WINDOW_HEIGHT
  };
}

function getIslandLayoutShrinkDelay(currentHeight: number, nextHeight: number): number {
  if (nextHeight >= currentHeight) return 0;
  if (currentHeight >= ISLAND_PANEL_CANVAS_HEIGHT) return ISLAND_LAYOUT_SHRINK_SETTLE_MS;
  if (currentHeight > ISLAND_BAR_WINDOW_HEIGHT) return ISLAND_NOTICE_LAYOUT_SHRINK_SETTLE_MS;
  return 0;
}

function estimatePermissionNoticeCanvasHeight(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null
): number {
  const detailText =
    permission?.prompt ??
    permission?.command ??
    mirroredPrompt?.message ??
    mirroredPrompt?.title ??
    '';
  const detailUnits = measureTextUnits(detailText);
  const extraLineCount = Math.max(0, Math.ceil((detailUnits - 26) / 18));

  let height = ISLAND_BAR_CANVAS_HEIGHT + 112;

  if (mirroredPrompt) {
    height += 28;
  }

  if (permission?.prompt) {
    height += 18;
  }

  if (permission?.command) {
    height += 18;
  }

  if (permission?.kind === 'permission') {
    height += 54;
  }

  if (permission?.kind === 'question') {
    height += permission.choices?.length ? 82 : 126;
    if (permission.choices && permission.choices.length > 3) {
      height += Math.ceil((permission.choices.length - 3) / 2) * 36;
    }
  }

  height += extraLineCount * 18;

  return Math.max(236, Math.min(ISLAND_PANEL_WINDOW_HEIGHT, height + ISLAND_SHELL_PADDING_TOP + ISLAND_SHELL_PADDING_BOTTOM));
}

type IslandAnimationState =
  | 'idle'
  | 'running'
  | 'notify'
  | 'permissionNotice'
  | 'complete'
  | 'expanded'
  | 'collapsing'
  | 'peeking';

function getIslandAnimationState({
  active,
  notification,
  presentationPhase,
  permission,
  mirroredPrompt,
  tone
}: {
  active: AgentSession | undefined;
  notification: NormalizedEvent | null;
  presentationPhase: IslandPresentationPhase;
  permission: PermissionRequest | undefined;
  mirroredPrompt: NormalizedEvent | null;
  tone: IslandTone;
}): IslandAnimationState {
  if (presentationPhase === 'collapsing') return 'collapsing';
  if (tone === 'completed' && presentationPhase === 'expanded') return 'complete';
  if (presentationPhase === 'expanding' || presentationPhase === 'expanded') return 'expanded';
  if (isPeekPresentationPhase(presentationPhase)) return 'peeking';
  if (permission || mirroredPrompt) return 'permissionNotice';
  if (tone === 'completed') return 'complete';
  if (notification) return 'notify';
  if (isSessionRunning(active)) return 'running';
  return 'idle';
}

function measureTextUnits(value: string): number {
  return Array.from(value).reduce((sum, char) => sum + (/[\u4e00-\u9fff]/.test(char) ? 1.75 : 1), 0);
}

function getIslandCountdown(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null
): { key: string; durationMs: number } | null {
  if (permission) {
    return {
      key: `permission-${permission.id}`,
      durationMs: getPermissionNoticeTimeoutMs(permission.timeoutMs)
    };
  }
  if (mirroredPrompt) return null;
  if (notification && shouldAutoClearIslandNotification(notification)) {
    return {
      key: `notification-${notification.id}`,
      durationMs: ISLAND_NOTIFICATION_PROGRESS_MS
    };
  }
  return null;
}

function RollingText({
  value,
  textKey,
  className,
  delay = 0
}: {
  value: string;
  textKey: string;
  className: string;
  delay?: number;
}): JSX.Element {
  return (
    <span className={`${className} text-viewport`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={textKey}
          className="text-roll-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ ...islandMotion.content, delay }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function getWorkspaceName(workspace: string): string {
  return workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? workspace;
}

type IslandTone = Exclude<IslandAttentionReason, 'none'> | 'permission' | 'running' | 'idle';

function getDisplayNotification(notification: NormalizedEvent | null): NormalizedEvent | null {
  if (!notification) return null;
  if (isLowSignalStatusEvent(notification)) return null;
  return notification;
}

function getIslandPrimaryText(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined,
  workspaceLabel: string | undefined
): string {
  if (permission) return permission.action;
  if (mirroredPrompt) return getMirroredPermissionAction(mirroredPrompt);
  if (notification) return notification.title;
  if (active?.status === 'user') return `${agentLabels[active.agent]} 收到输入`;
  return workspaceLabel ?? 'Vibe Island';
}

function getIslandSecondaryText(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined
): string {
  if (permission) return getActionableKindLabel(permission);
  if (mirroredPrompt) return '请在 Claude 会话中审批';
  if (notification) return notification.message ?? formatSessionSummary(active);
  if (active?.status === 'user') return active.lastMessage && active.lastMessage !== active.title ? active.lastMessage : '等待 Agent 响应';
  return formatSessionSummary(active);
}

function getIslandTone(
  permission: PermissionRequest | undefined,
  mirroredPrompt: NormalizedEvent | null,
  notification: NormalizedEvent | null,
  active: AgentSession | undefined
): IslandTone {
  if (permission) return 'permission';
  if (mirroredPrompt) return 'permission';
  if (!notification) {
    if (isSessionCompleted(active)) return 'completed';
    return isSessionRunning(active) ? 'running' : 'idle';
  }
  const reason = getIslandAttentionReason(notification);
  return reason === 'none' ? 'realtime' : reason;
}

function isSessionRunning(session: AgentSession | undefined): boolean {
  if (!session) return false;
  return ['tool-start', 'session-start', 'user', 'status'].includes(session.status);
}

function isSessionCompleted(session: AgentSession | undefined): boolean {
  return session?.status === 'session-stop';
}

function renderIslandStatusIcon(tone: IslandTone, completionReady = false): JSX.Element {
  if (tone === 'permission') return <ShieldAlert size={18} className="status-icon warning-icon" />;
  if (tone === 'error') return <AlertTriangle size={18} className="status-icon error-icon" />;
  if (tone === 'completed') {
    return (
      <span className={`completion-badge ${completionReady ? 'is-ready' : 'is-waiting'}`} aria-label="任务完成">
        <svg className="completion-check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5.2 12.6 9.4 16.8 18.9 6.9" />
        </svg>
      </span>
    );
  }
  if (tone === 'question') return <MessageCircle size={18} className="status-icon question-icon" />;
  return (
    <span className="activity-indicator" aria-label={tone === 'idle' ? '空闲' : '运行中'}>
      <Activity size={18} />
    </span>
  );
}

function getMirroredPromptNotification(notification: NormalizedEvent | null): NormalizedEvent | null {
  if (!notification) return null;
  return isMirroredPermissionNotification(notification) ? notification : null;
}

function isMirroredPermissionNotification(notification: NormalizedEvent): boolean {
  if (notification.agent !== 'claude' || notification.eventType !== 'notification') return false;
  const notificationType = String(notification.metadata?.notification_type ?? '').toLowerCase();
  const text = `${notification.title} ${notification.message ?? ''}`.toLowerCase();
  return notificationType === 'permission_prompt' || /needs your permission|需要.*权限/.test(text);
}

function getMirroredPermissionAction(notification: NormalizedEvent): string {
  const tool = getMirroredPermissionTool(notification);
  if (tool) return `请求使用 ${tool}`;
  return notification.title;
}

function getMirroredPermissionTool(notification: NormalizedEvent): string | undefined {
  const directTool = typeof notification.toolName === 'string' && notification.toolName.trim().length > 0 ? notification.toolName : undefined;
  if (directTool) return directTool;
  const metadataTool = notification.metadata?.tool_name;
  if (typeof metadataTool === 'string' && metadataTool.trim().length > 0) return metadataTool;
  const message = notification.message ?? '';
  const englishMatch = message.match(/permission to use\s+(.+?)(?:[.!?]|$)/i);
  if (englishMatch?.[1]) return englishMatch[1].trim();
  const chineseMatch = message.match(/使用(.+?)(?:前)?需要.*权限/);
  return chineseMatch?.[1]?.trim();
}

function formatSessionSummary(session: AgentSession | undefined): string {
  if (!session) return '空闲';
  if (session.status === 'tool-start') return `${agentLabels[session.agent]} 运行中`;
  if (session.status === 'tool-end') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-stop') return `${agentLabels[session.agent]} 空闲`;
  if (session.status === 'session-start') return `${agentLabels[session.agent]} 已开始`;
  if (session.status === 'user') return `${agentLabels[session.agent]} 收到输入`;
  if (session.status === 'error') return `${agentLabels[session.agent]} 出错`;
  return `${agentLabels[session.agent]} 活动中`;
}

function isLowSignalStatusEvent(event: NormalizedEvent): boolean {
  if (event.metadata?.source === 'jump') return true;
  const notificationType = String(event.metadata?.notification_type ?? '').toLowerCase();
  if (notificationType === 'permission_prompt' || notificationType === 'input_waiting') return false;
  if (notificationType === 'idle_prompt') return true;
  const name = String(
    event.metadata?.hook_event_name ?? event.metadata?.eventType ?? event.metadata?.type ?? event.eventType
  ).toLowerCase();
  if (name === 'statusline') return true;
  return event.eventType === 'status' && /状态更新|status update/i.test(event.title);
}

function isLowSignalSession(session: AgentSession): boolean {
  if (session.metadata?.discoverySource === 'jump') return true;
  return session.status === 'status' && session.lastMessage === 'Discovered local session' && !session.metadata?.terminal;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    void promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      })
  });
}

export default App;
