"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight, ArrowUpRight, Bike, Building2, Check, CheckCircle2, ChevronDown, Clock3,
  HandHeart, Leaf, Loader2, MapPin, Plus, QrCode, UserPlus, Users, Wallet, Wrench, X
} from "lucide-react";

import { PaymentStatus } from "@/components/payment-status";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { usePaymentWatcher } from "@/hooks/use-payment-watcher";
import { circlesConfig, decodeTransferData, fetchTransferDataEvents, generatePaymentLink } from "@/lib/circles";
import { connectCommunityWallet, isCommunityMemberApproved, payOutCommunityFunds, registerCommunity, trustCommunityMember } from "@/lib/community";
import { loadCommunities, loadMembershipRequests, loadProjects, loadReferralMetrics, loadServices, loadWebsiteVisitCount, markProjectWithdrawn, publishProject, publishService, registerCommunityMetadata, removeMembershipRequest, requestMembership as persistMembershipRequest, trackReferralVisit, trackWebsiteVisit, type MembershipRequest, type StoredCommunity, type StoredProject, type StoredService } from "@/lib/commons-storage";
import { createEscrowProject, escrowAddress, escrowRecipientForProject, fetchEscrowFundingEvents, fetchEscrowWithdrawalEvents, fundEscrowProject, makeEscrowProjectId, withdrawEscrowProject } from "@/lib/escrow";
import { loadProfileNames } from "@/lib/profiles";

type Service = StoredService & { icon: typeof Bike; tone: string };
type Project = StoredProject & { raised: number; contributors: number };
type Checkout =
  | { kind: "service"; item: Service; amount: number }
  | { kind: "project"; item: Project; amount: number };
type Activity = { hash: string; text: string; amount: string; time: string; blockNumber: bigint };
const ACTIVE_COMMUNITY_STORAGE_KEY = "circles-commons-active-community";
const defaultCommunities: StoredCommunity[] = circlesConfig.defaultRecipientAddress ? [{
  address: circlesConfig.defaultRecipientAddress,
  name: "Commons Lab",
  description: "Legacy fallback account for older Commons data.",
  kind: "organization",
  treasuryAddress: circlesConfig.defaultRecipientAddress,
  adminAddress: circlesConfig.defaultAdminAddress || circlesConfig.defaultRecipientAddress,
  source: "created"
}] : [];

const initialProjects: Project[] = [];

function mergeCommunityState(...lists: StoredCommunity[][]) {
  const merged = new Map<string, StoredCommunity>();
  for (const community of lists.flat()) {
    if (!community.address) continue;
    merged.set(community.address.toLowerCase(), community);
  }
  return [...merged.values()];
}

function defaultProjectsForCommunity(_address?: string) {
  return initialProjects;
}

function makeReference(kind: Checkout["kind"], id: string, amount: number) {
  return `commons:${kind}:${id}:${amount}:${crypto.randomUUID()}`;
}

function parseReference(data: string) {
  const match = data.match(/commons:(project|service):([^:]+):(?:(\d+):)?[0-9a-f-]{36}/i);
  return match ? { kind: match[1], id: match[2], amount: match[3] ? Number(match[3]) : 10 } : null;
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function creatorLabel(address: string | undefined, profiles: Record<string, string>) {
  if (!address) return "early demo";
  return profiles[normalizeAddress(address)] ?? shortAddress(address);
}

function isDeadlineExpired(deadline?: string) {
  return Boolean(deadline && Date.now() >= new Date(deadline).getTime());
}

function isProjectComplete(project: Pick<Project, "raised" | "goal" | "status" | "deadline">) {
  return project.status === "withdrawn" || project.raised >= project.goal || isDeadlineExpired(project.deadline);
}

function projectContributionAmounts(project: Pick<Project, "raised" | "goal">) {
  const remaining = Math.max(0, Number((project.goal - project.raised).toFixed(6)));
  const presets = [10, 25, 50].filter((amount) => amount <= remaining);
  return presets.length > 0 ? presets : remaining > 0 ? [remaining] : [];
}

function decorateService(service: StoredService, index: number): Service {
  const styles = [
    { icon: Bike, tone: "bg-coral/10 text-coral" },
    { icon: Users, tone: "bg-indigo/10 text-indigo" },
    { icon: Wrench, tone: "bg-moss/15 text-moss" }
  ];
  return { ...service, ...styles[index % styles.length] };
}

export default function Home() {
  const { address: hostWalletAddress, isConnected: isHostWalletConnected, isMiniappHost } = useWallet();
  const [communities, setCommunities] = useState<StoredCommunity[]>(defaultCommunities);
  const [services, setServices] = useState<Service[]>([]);
  const [activeCommunityAddress, setActiveCommunityAddress] = useState(circlesConfig.defaultRecipientAddress);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectDefinitions, setProjectDefinitions] = useState<StoredProject[]>([]);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [reference, setReference] = useState("");
  const [watching, setWatching] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [embeddedPaymentState, setEmbeddedPaymentState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [embeddedPaymentError, setEmbeddedPaymentError] = useState("");
  const [appliedReference, setAppliedReference] = useState("");
  const [communityModal, setCommunityModal] = useState<"create" | "manage" | null>(null);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showCommunityPicker, setShowCommunityPicker] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [communityName, setCommunityName] = useState("");
  const [communityDescription, setCommunityDescription] = useState("");
  const [connectedWallet, setConnectedWallet] = useState("");
  const [organizationAddress, setOrganizationAddress] = useState("");
  const [communityError, setCommunityError] = useState("");
  const [communityStep, setCommunityStep] = useState<"idle" | "connecting" | "registering" | "created">("idle");
  const [serviceError, setServiceError] = useState("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceProvider, setServiceProvider] = useState("");
  const [serviceProviderAddress, setServiceProviderAddress] = useState("");
  const [serviceDuration, setServiceDuration] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [projectError, setProjectError] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectLocation, setProjectLocation] = useState("");
  const [projectGoal, setProjectGoal] = useState("");
  const [projectMilestoneOne, setProjectMilestoneOne] = useState("");
  const [projectMilestoneTwo, setProjectMilestoneTwo] = useState("");
  const [projectMilestoneThree, setProjectMilestoneThree] = useState("");
  const [payoutRecipient, setPayoutRecipient] = useState("");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutMemo, setPayoutMemo] = useState("");
  const [payoutState, setPayoutState] = useState<"idle" | "sending" | "sent">("idle");
  const [payoutError, setPayoutError] = useState("");
  const [memberAddress, setMemberAddress] = useState("");
  const [trustState, setTrustState] = useState<"idle" | "adding" | "added">("idle");
  const [approvedAddresses, setApprovedAddresses] = useState<string[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [showJoin, setShowJoin] = useState(false);
  const [joinAddress, setJoinAddress] = useState("");
  const [membershipRequests, setMembershipRequests] = useState<MembershipRequest[]>([]);
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [rpcMetrics, setRpcMetrics] = useState({ crc: 0, transactions: 0, projects: 0 });
  const [referralMetrics, setReferralMetrics] = useState({ wallets: 0, inviteSources: 0 });
  const [websiteVisits, setWebsiteVisits] = useState(0);
  const [rpcRefresh, setRpcRefresh] = useState(0);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [withdrawProject, setWithdrawProject] = useState<Project | null>(null);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [withdrawState, setWithdrawState] = useState<"idle" | "submitting" | "submitted">("idle");
  const [withdrawError, setWithdrawError] = useState("");
  const [inviteState, setInviteState] = useState<"idle" | "copied" | "error">("idle");
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);

  const recipientAddress = activeCommunityAddress;
  const organizationTreasuries = communities.filter((community) => community.kind !== "group");
  const activeCommunity = organizationTreasuries.find((community) => community.address.toLowerCase() === recipientAddress.toLowerCase()) ?? organizationTreasuries[0];
  const communityTreasuryAddress = activeCommunity?.treasuryAddress ?? recipientAddress;
  const communityAdminAddress = activeCommunity?.adminAddress ?? communityTreasuryAddress;
  const activeCommunityKindLabel = "Escrow project";
  const isConnectedAdmin = Boolean(communityAdminAddress && connectedWallet && communityAdminAddress.toLowerCase() === connectedWallet.toLowerCase());
  const canAdminSendTreasuryTransactions = Boolean(communityTreasuryAddress && communityAdminAddress && communityTreasuryAddress.toLowerCase() === communityAdminAddress.toLowerCase());
  const checkoutRecipientAddress = checkout?.kind === "service" ? checkout.item.providerAddress : checkout?.kind === "project" ? escrowRecipientForProject(checkout.item) : "";
  const paymentLink = useMemo(() => checkout && reference && checkoutRecipientAddress
    ? generatePaymentLink(checkoutRecipientAddress, checkout.amount, reference)
    : "", [checkout, checkoutRecipientAddress, reference]);
  const playgroundLink = useMemo(() => {
    const fallback = "https://circles-commons.vercel.app";
    const origin = typeof window === "undefined" ? fallback : window.location.origin;
    const appUrl = origin.includes("localhost") || origin.includes("127.0.0.1") ? fallback : origin;
    return `https://circles.gnosis.io/playground?url=${encodeURIComponent(appUrl)}`;
  }, []);
  const { status, payment, error } = usePaymentWatcher({
    enabled: watching && Boolean(checkout), dataValue: reference,
    minAmountCRC: checkout?.amount ?? 0, recipientAddress: checkoutRecipientAddress
  });

  useEffect(() => {
    if (isMiniappHost) setJoinAddress(hostWalletAddress ?? "");
  }, [hostWalletAddress, isMiniappHost]);

  useEffect(() => {
    if (!isMiniappHost || !hostWalletAddress || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (!ref) return;
    trackReferralVisit(ref, hostWalletAddress, params.get("project"))
      .then(() => loadReferralMetrics())
      .then(setReferralMetrics)
      .catch(() => {});
  }, [hostWalletAddress, isMiniappHost]);

  useEffect(() => {
    let active = true;
    loadReferralMetrics().then((metrics) => {
      if (active) setReferralMetrics(metrics);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    trackWebsiteVisit()
      .catch(() => {})
      .then(() => loadWebsiteVisitCount())
      .then((count) => { if (active) setWebsiteVisits(count); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const selectCommunity = (address: string) => {
    setActiveCommunityAddress(address);
    window.localStorage.setItem(ACTIVE_COMMUNITY_STORAGE_KEY, address);
    setShowCommunityPicker(false);
  };

  useEffect(() => {
    let active = true;
    if (!paymentLink) return;
    (async () => {
      try {
        const { toDataURL } = await import("qrcode");
        const value = await toDataURL(paymentLink, { width: 240, margin: 1 });
        if (active) setQrCode(value);
      } catch { if (active) setQrCode(""); }
    })();
    return () => { active = false; };
  }, [paymentLink]);


  useEffect(() => {
    loadCommunities(defaultCommunities).then((stored) => {
      setCommunities(stored);
      const treasuries = stored.filter((community) => community.kind !== "group");
      const selected = window.localStorage.getItem(ACTIVE_COMMUNITY_STORAGE_KEY);
      const next = treasuries.find((community) => community.address.toLowerCase() === selected?.toLowerCase()) ?? treasuries[0];
      if (next) {
        setActiveCommunityAddress(next.address);
        window.localStorage.setItem(ACTIVE_COMMUNITY_STORAGE_KEY, next.address);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadMembershipRequests(recipientAddress).then(setMembershipRequests).catch(() => {});
  }, [recipientAddress]);

  useEffect(() => {
    loadProjects(recipientAddress, defaultProjectsForCommunity(recipientAddress)).then((stored) => {
      setProjectDefinitions(stored);
      setProjects(stored.map((project) => ({ ...project, raised: 0, contributors: 0 })));
    }).catch(() => {});
  }, [recipientAddress]);

  useEffect(() => {
    loadServices(recipientAddress).then((stored) => {
      setServices(stored.map(decorateService));
    }).catch(() => setServices([]));
  }, [recipientAddress]);

  useEffect(() => {
    const owners = projectDefinitions.map((project) => project.ownerAddress ?? "").filter(Boolean);
    loadProfileNames(owners).then(setProfileNames).catch(() => {});
  }, [projectDefinitions]);

  useEffect(() => {
    if (isMiniappHost) setServiceProviderAddress(hostWalletAddress ?? "");
  }, [hostWalletAddress, isMiniappHost]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [escrowEvents, withdrawalEvents] = await Promise.all([
        fetchEscrowFundingEvents(projectDefinitions),
        fetchEscrowWithdrawalEvents(projectDefinitions)
      ]);
      const projectByEscrowId = new Map(projectDefinitions.map((project) => [makeEscrowProjectId(project.id), project]));
      const withdrawalsByProject = new Map(withdrawalEvents.map((event) => [event.projectId, event]));
      const contributions = escrowEvents.map((event) => {
        const project = projectByEscrowId.get(event.projectId);
        return {
          id: project?.id ?? event.projectId,
          title: project?.title ?? "project",
          amount: event.amountCRC,
          hash: event.transactionHash,
          contributor: event.contributor,
          blockNumber: event.blockNumber
        };
      });
      const activityRecipients = services.map((service) => service.providerAddress)
        .filter((address, index, list) => address && list.findIndex((item) => item.toLowerCase() === address.toLowerCase()) === index);
      const eventBatches = await Promise.all(activityRecipients.map((address) => fetchTransferDataEvents(200, address)));
      const events = eventBatches.flat();
      const activityProfileNames = await loadProfileNames([
        ...contributions.map((item) => item.contributor),
        ...withdrawalEvents.map((event) => event.owner),
        ...events.map((event) => event.from)
      ]);
      const actorName = (address: string) => activityProfileNames[normalizeAddress(address)] || shortAddress(address);
      setProfileNames((current) => ({ ...current, ...activityProfileNames }));

      const nextActivity: Activity[] = contributions
        .sort((a, b) => Number(b.blockNumber - a.blockNumber))
        .map((item) => ({
          hash: item.hash,
          text: `${actorName(item.contributor)} funded ${item.title}`,
          amount: `+${item.amount} CRC`,
          time: "Confirmed on-chain",
          blockNumber: item.blockNumber
        }));
      withdrawalEvents.forEach((event) => {
        const project = projectByEscrowId.get(event.projectId);
        nextActivity.push({
          hash: event.transactionHash,
          text: `${actorName(event.owner)} withdrew ${project?.title ?? "project"} funds`,
          amount: `${event.amountCRC} CRC`,
          time: "Confirmed on-chain",
          blockNumber: event.blockNumber
        });
      });

      for (const event of events) {
        const reference = parseReference(decodeTransferData(event.data));
        if (!reference || reference.kind !== "service") continue;
        const service = services.find((item) => item.id === reference.id);
        nextActivity.push({
          hash: event.transactionHash,
          text: `${actorName(event.from)} booked ${service?.title ?? reference.id}`,
          amount: `${reference.amount} CRC`,
          time: "Confirmed on-chain",
          blockNumber: BigInt(event.blockNumber || 0)
        });
      }
      if (!active) return;
      setActivity(nextActivity.sort((a, b) => Number(b.blockNumber - a.blockNumber)).slice(0, 5));
      setProjects(projectDefinitions.map((project) => {
        const withdrawal = withdrawalsByProject.get(makeEscrowProjectId(project.id));
        const matching = contributions.filter((item) => item.id === project.id);
        const amount = matching.reduce((total, item) => total + item.amount, 0);
        return {
          ...project,
          raised: Math.min(project.goal, amount),
          contributors: new Set(matching.map((item) => item.contributor.toLowerCase())).size,
          status: withdrawal ? "withdrawn" : project.status,
          withdrawNote: withdrawal?.note ?? project.withdrawNote
        };
      }));
      setRpcMetrics({
        crc: contributions.reduce((total, item) => total + item.amount, 0),
        transactions: escrowEvents.length + withdrawalEvents.length + events.length,
        projects: new Set(contributions.map((item) => item.id)).size
      });
    })().catch(() => {});
    return () => { active = false; };
  }, [projectDefinitions, rpcRefresh, services]);

  useEffect(() => {
    if (status !== "confirmed" || !checkout || appliedReference === reference) return;
    if (checkout.kind === "project") {
      setRpcRefresh((current) => current + 1);
    }
    setAppliedReference(reference);
  }, [appliedReference, checkout, payment?.transactionHash, reference, status]);

  const openCheckout = (next: Checkout) => {
    setCheckout(next); setReference(makeReference(next.kind, next.item.id, next.amount));
    setWatching(false); setShowQr(false); setQrCode(""); setCopyState("idle"); setEmbeddedPaymentState("idle"); setEmbeddedPaymentError("");
  };
  const closeCheckout = () => { setCheckout(null); setReference(""); setWatching(false); setShowQr(false); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(paymentLink); setCopyState("copied"); window.setTimeout(() => setCopyState("idle"), 1600); }
    catch { setCopyState("error"); }
  };
  const inviteLink = (projectId?: string) => {
    const fallback = "https://circles-commons.vercel.app";
    const origin = typeof window === "undefined" ? fallback : window.location.origin;
    const baseUrl = origin.includes("localhost") || origin.includes("127.0.0.1") ? fallback : origin;
    const ref = hostWalletAddress ? normalizeAddress(hostWalletAddress) : "commons";
    const appUrl = new URL(baseUrl);
    appUrl.searchParams.set("ref", ref);
    if (projectId) appUrl.searchParams.set("project", projectId);
    return `https://circles.gnosis.io/playground?url=${encodeURIComponent(appUrl.toString())}`;
  };
  const copyInviteLink = async (projectId?: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(projectId));
      setInviteState("copied");
      window.setTimeout(() => setInviteState("idle"), 1600);
    } catch {
      setInviteState("error");
    }
  };
  const payInsideGnosisApp = async () => {
    if (!hostWalletAddress || !checkoutRecipientAddress || !checkout || !reference) return;
    setEmbeddedPaymentState("submitting");
    setEmbeddedPaymentError("");
    try {
      if (checkout.kind === "project") {
        await fundEscrowProject({
          from: hostWalletAddress,
          project: checkout.item,
          amountCRC: checkout.amount,
          reference
        });
      } else {
        const { sendEmbeddedCrcPayment } = await import("@/lib/embedded-payments");
        await sendEmbeddedCrcPayment(hostWalletAddress, checkoutRecipientAddress, checkout.amount, reference);
      }
      setEmbeddedPaymentState("submitted");
      setWatching(true);
    } catch (error) {
      setEmbeddedPaymentError(error instanceof Error ? error.message : "The transaction was not submitted.");
      setEmbeddedPaymentState("error");
    }
  };
  const submitWithdraw = async () => {
    if (!withdrawProject || !hostWalletAddress) return;
    const ownerMatches = withdrawProject.ownerAddress && normalizeAddress(withdrawProject.ownerAddress) === normalizeAddress(hostWalletAddress);
    const canWithdraw = ownerMatches && (withdrawProject.raised >= withdrawProject.goal || isDeadlineExpired(withdrawProject.deadline));
    if (!canWithdraw) {
      setWithdrawError("Only the project creator can withdraw after the goal is reached or the 14-day deadline has passed.");
      return;
    }

    setWithdrawState("submitting");
    setWithdrawError("");
    try {
      await withdrawEscrowProject(withdrawProject, withdrawNote.trim());
      await markProjectWithdrawn(withdrawProject.id, withdrawNote.trim()).catch(() => {});
      setProjects((current) => current.map((project) => project.id === withdrawProject.id
        ? { ...project, status: "withdrawn", withdrawNote: withdrawNote.trim() }
        : project
      ));
      setProjectDefinitions((current) => current.map((project) => project.id === withdrawProject.id
        ? { ...project, status: "withdrawn", withdrawNote: withdrawNote.trim() }
        : project
      ));
      setWithdrawState("submitted");
      setRpcRefresh((current) => current + 1);
    } catch (error) {
      setWithdrawError(error instanceof Error ? error.message : "Withdrawal was not submitted.");
      setWithdrawState("idle");
    }
  };
  const resetServiceForm = () => {
    setServiceError("");
    setServiceTitle("");
    setServiceDescription("");
    setServiceProvider("");
    setServiceProviderAddress(isMiniappHost ? hostWalletAddress ?? "" : "");
    setServiceDuration("");
    setServicePrice("");
  };
  const submitService = async () => {
    const price = Number(servicePrice);
    const providerAddress = (isMiniappHost ? hostWalletAddress : serviceProviderAddress)?.trim();
    if (!serviceTitle.trim() || !serviceDescription.trim() || !serviceProvider.trim() || !serviceDuration.trim() || !providerAddress || !Number.isFinite(price) || price <= 0) {
      setServiceError("Fill every field with a valid Circles address and CRC price.");
      return;
    }
    setServiceError("");
    const service: StoredService = {
      id: crypto.randomUUID(),
      title: serviceTitle.trim(),
      description: serviceDescription.trim(),
      provider: serviceProvider.trim(),
      providerAddress,
      duration: serviceDuration.trim(),
      price
    };
    try {
      await publishService(recipientAddress, service);
      setServices((current) => [decorateService(service, current.length), ...current]);
      setShowServiceForm(false);
      resetServiceForm();
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : "Could not publish this service.");
    }
  };
  const resetProjectForm = () => {
    setProjectError("");
    setProjectTitle("");
    setProjectDescription("");
    setProjectLocation("");
    setProjectGoal("");
    setProjectMilestoneOne("");
    setProjectMilestoneTwo("");
    setProjectMilestoneThree("");
  };
  const submitProject = async () => {
    const goal = Number(projectGoal);
    const ownerAddress = hostWalletAddress;
    const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const projectId = crypto.randomUUID();
    if (!isMiniappHost || !ownerAddress) {
      setProjectError("Open Circles Commons in the Playground and connect your Gnosis App wallet first.");
      return;
    }
    if (!projectTitle.trim() || !projectDescription.trim() || !projectLocation.trim() || !Number.isFinite(goal) || goal <= 0) {
      setProjectError("Fill title, description, location and a valid CRC goal.");
      return;
    }
    const labels = [projectMilestoneOne, projectMilestoneTwo, projectMilestoneThree].map((label) => label.trim());
    if (labels.some((label) => !label)) {
      setProjectError("Add three milestone labels so contributors know what each threshold unlocks.");
      return;
    }
    const projectBase: StoredProject = {
      id: projectId,
      title: projectTitle.trim(),
      description: projectDescription.trim(),
      location: projectLocation.trim(),
      goal,
      ownerAddress,
      deadline: deadline.toISOString(),
      status: "open",
      milestones: [
        { amount: Number((goal * 0.2).toFixed(2)), label: labels[0] },
        { amount: Number((goal * 0.5).toFixed(2)), label: labels[1] },
        { amount: goal, label: labels[2] }
      ]
    };
    try {
      const vaultAddress = await createEscrowProject({
        id: projectBase.id,
        goal,
        deadline: Math.floor(deadline.getTime() / 1000),
        metadataURI: `supabase:projects:${projectBase.id}`
      });
      const project: StoredProject = { ...projectBase, contractVersion: "v2", vaultAddress };
      await publishProject(recipientAddress, project);
      setProjectDefinitions((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setProjects((current) => [{ ...project, raised: 0, contributors: 0 }, ...current.filter((item) => item.id !== project.id)]);
      resetProjectForm();
      setShowProjectForm(false);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create this project.");
    }
  };
  const submitPayout = async () => {
    const amount = Number(payoutAmount);
    if (!recipientAddress || !payoutRecipient.trim() || !Number.isFinite(amount) || amount <= 0) {
      setPayoutError("Enter a recipient address and a valid CRC amount.");
      return;
    }
    setPayoutError("");
    setPayoutState("sending");
    try {
      await payOutCommunityFunds(
        communityTreasuryAddress as `0x${string}`,
        payoutRecipient.trim() as `0x${string}`,
        amount,
        payoutMemo.trim() || `commons:payout:${activeCommunity?.name ?? "treasury"}`
      );
      setPayoutState("sent");
      setPayoutRecipient("");
      setPayoutAmount("");
      setPayoutMemo("");
      setRpcRefresh((current) => current + 1);
    } catch (error) {
      setPayoutError(error instanceof Error ? error.message : "Could not pay out treasury funds.");
      setPayoutState("idle");
    }
  };
  const connectWallet = async () => {
    setCommunityError(""); setCommunityStep("connecting");
    try { setConnectedWallet(await connectCommunityWallet()); setCommunityStep("idle"); }
    catch (error) { setCommunityError(error instanceof Error ? error.message : "Wallet connection failed."); setCommunityStep("idle"); }
  };
  const createCommunity = async () => {
    if (!communityName.trim()) return;
    setCommunityError(""); setCommunityStep("registering");
    try {
      const created = await registerCommunity(communityName.trim(), communityDescription.trim());
      const community = { name: communityName.trim(), description: communityDescription.trim(), address: created.address, kind: "organization" as const, treasuryAddress: created.address, adminAddress: created.signer, source: "created" as const };
      await registerCommunityMetadata(community);
      setConnectedWallet(created.signer); setOrganizationAddress(created.address); setCommunityStep("created");
      const storedCommunities = await loadCommunities(defaultCommunities);
      setCommunities(mergeCommunityState(storedCommunities, [community]));
      setProjectDefinitions([]);
      setProjects([]);
      setActiveCommunityAddress(created.address);
      window.localStorage.setItem(ACTIVE_COMMUNITY_STORAGE_KEY, created.address);
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : "Organization registration failed."); setCommunityStep("idle");
    }
  };
  const addMemberTrust = async (address = memberAddress) => {
    if (!recipientAddress || !address.trim()) return;
    setCommunityError(""); setTrustState("adding");
    try {
      await trustCommunityMember(communityTreasuryAddress as `0x${string}`, address.trim() as `0x${string}`);
      setTrustState("added");
      setApprovedAddresses((current) => [...new Set([...current, address.trim().toLowerCase()])]);
      const remaining = membershipRequests.filter((request) => request.address.toLowerCase() !== address.trim().toLowerCase());
      setMembershipRequests(remaining);
      await removeMembershipRequest(recipientAddress, address.trim());
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : "Could not trust this member.");
      setTrustState("idle");
    }
  };
  const refreshMemberApproval = useCallback(async (address: string) => {
    if (!communityTreasuryAddress || !address.trim()) return;
    if (await isCommunityMemberApproved(communityTreasuryAddress as `0x${string}`, address.trim() as `0x${string}`)) {
      setApprovedAddresses((current) => [...new Set([...current, address.trim().toLowerCase()])]);
    }
  }, [communityTreasuryAddress]);
  const requestMembership = async () => {
    const address = (isMiniappHost ? hostWalletAddress ?? "" : joinAddress).trim();
    if (!address) return;
    await persistMembershipRequest(recipientAddress, address);
    const next = membershipRequests.some((request) => request.address.toLowerCase() === address.toLowerCase())
      ? membershipRequests
      : [...membershipRequests, { address, requestedAt: new Date().toISOString() }];
    setMembershipRequests(next);
    setJoinSubmitted(true);
  };

  useEffect(() => {
    if (communityModal !== "manage" || !isConnectedAdmin || !recipientAddress) return;
    [memberAddress, ...membershipRequests.map((request) => request.address)].forEach((address) => {
      refreshMemberApproval(address).catch(() => {});
    });
  }, [communityModal, isConnectedAdmin, memberAddress, membershipRequests, recipientAddress, refreshMemberApproval]);

  return (
    <main>
      <header className="border-b border-ink/10 bg-cream/90 px-5 py-4 backdrop-blur md:px-8">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/circles-logo.svg" alt="Circles" width={120} height={36} className="h-7 w-auto" priority />
            <span className="h-6 w-px bg-ink/15" />
            <Image src="/commons-logo.svg" alt="Commons" width={144} height={24} className="h-6 w-auto" priority />
          </div>
          <div className="hidden items-center gap-6 text-sm font-medium text-ink/60 sm:flex">
            <a href="#projects">Projects</a>
            <a href="#activity">Activity</a>
            <span className="inline-flex items-center gap-2 text-ink/40">
              Referrals
              <span className="rounded-full bg-indigo/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo">Coming soon</span>
            </span>
          </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{isMiniappHost && <span className={`rounded-full px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider ${isHostWalletConnected ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"}`}>{isHostWalletConnected ? `Connected ${shortAddress(hostWalletAddress ?? "")}` : "Waiting for Gnosis"}</span>}{isMiniappHost ? <Button size="sm" onClick={() => { resetProjectForm(); setShowProjectForm(true); }} disabled={!hostWalletAddress}><Plus className="h-4 w-4" />New project</Button> : <Button asChild size="sm"><a href={playgroundLink} target="_blank" rel="noreferrer"><Wallet className="h-4 w-4" />Connect wallet</a></Button>}</div>
        </nav>
      </header>

      <section className="px-5 pb-14 pt-14 md:px-8 md:pb-20 md:pt-20">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-5 inline-flex rounded-full border border-moss/20 bg-moss/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-moss">Escrow-funded projects for Circles communities</p>
            <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.02] tracking-[-0.06em] sm:text-6xl">Fund people&apos;s projects.<br /><span className="text-indigo">Pay out in CRC.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">Create a funded project with your Gnosis App wallet, let contributors send CRC into escrow, then withdraw when the goal is reached or the deadline expires.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><a href="#projects">Fund a project <ArrowRight className="h-4 w-4" /></a></Button>
              <Button asChild size="lg" variant="outline"><a href={playgroundLink} target="_blank" rel="noreferrer">Open in Playground</a></Button>
            </div>
          </div>
          <div className="rounded-[2rem] border border-ink/10 bg-white/75 p-6 shadow-[0_24px_60px_-32px_rgba(37,27,159,0.35)]">
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/45">Commons dashboard</p><p className="mt-2 font-display text-3xl font-bold tracking-tight">Circles Commons stats</p><div className="mt-2 flex flex-wrap gap-2"><p className="w-fit rounded-full bg-indigo/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo">Gnosis App native</p></div><p className="mt-2 text-xs leading-5 text-ink/50">Live totals for CRC funded, escrow transactions and active funded projects.</p><p className="mt-2 text-[11px] leading-5 text-ink/40">Escrow: {escrowAddress ? shortAddress(escrowAddress) : "not deployed yet"}</p></div><div className="rounded-2xl bg-moss/10 p-3 text-moss"><HandHeart className="h-6 w-6" /></div></div>
            <div className="mt-7 grid grid-cols-3 gap-3"><Metric value={String(rpcMetrics.crc)} label="CRC funded" /><Metric value={String(rpcMetrics.transactions)} label="on-chain exchanges" /><Metric value={String(rpcMetrics.projects)} label="funded projects" /></div>
            <div className="mt-6 rounded-2xl bg-sand/65 p-4 text-sm leading-6 text-ink/65">CRC moves from contributors into escrow, then the project owner withdraws after the goal or deadline condition is met.</div>
          </div>
        </div>
      </section>

      <section id="services" className="hidden border-y border-ink/10 bg-white/55 px-5 py-14 md:px-8 md:py-20">
        <div className="mx-auto max-w-6xl"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><SectionHeading eyebrow="Exchange skills" title={`Services in ${activeCommunity?.name ?? "this community"}`} description="Members publish useful services and receive CRC directly at their own Circles address." /><Button onClick={() => { resetServiceForm(); setShowServiceForm(true); }}><Plus className="h-4 w-4" />Offer a service</Button></div>
          {services.length > 0 ? <div className="mt-8 grid gap-4 md:grid-cols-3">{services.map((service) => {
            const Icon = service.icon;
            return <article key={service.id} className="flex flex-col rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.45)]">
              <div className={`w-fit rounded-2xl p-3 ${service.tone}`}><Icon className="h-5 w-5" /></div>
              <h3 className="mt-5 font-display text-xl font-bold tracking-tight">{service.title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-ink/60">{service.description}</p>
              <div className="mt-5 space-y-2 text-xs font-medium text-ink/55"><p className="flex items-center gap-2"><Users className="h-3.5 w-3.5" />Offered by {service.provider}</p><p className="flex items-center gap-2"><Wallet className="h-3.5 w-3.5" />Paid to {shortAddress(service.providerAddress)}</p><p className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" />{service.duration}</p></div>
              <div className="mt-5 flex items-center justify-between border-t border-ink/10 pt-4"><span className="font-display text-lg font-bold">{service.price} CRC</span><Button size="sm" onClick={() => openCheckout({ kind: "service", item: service, amount: service.price })}>Book</Button></div>
            </article>;
          })}</div> : <div className="mt-8 rounded-3xl border border-dashed border-ink/15 bg-white/70 p-8 text-center"><h3 className="font-display text-2xl font-bold tracking-tight">No services posted yet</h3><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-ink/60">This community has no member services yet. Be the first to offer something useful and receive CRC directly.</p><Button className="mt-5" onClick={() => { resetServiceForm(); setShowServiceForm(true); }}><Plus className="h-4 w-4" />Offer the first service</Button></div>}
        </div>
      </section>

      <section id="projects" className="px-5 py-14 md:px-8 md:py-20"><div className="mx-auto max-w-6xl"><SectionHeading eyebrow="Funded projects" title="Open projects" description="These are public funding proposals created by Gnosis App wallets. Contributions go into the escrow contract and update from on-chain events." />
        <div className="mt-8 grid gap-5 md:grid-cols-2">{projects.map((project) => {
          const completed = isProjectComplete(project);
          const withdrawn = project.status === "withdrawn";
          const goalReached = project.raised >= project.goal;
          const deadlineEnded = isDeadlineExpired(project.deadline);
          const ownerMatches = Boolean(project.ownerAddress && hostWalletAddress && normalizeAddress(project.ownerAddress) === normalizeAddress(hostWalletAddress));
          const withdrawable = ownerMatches && !withdrawn && (goalReached || deadlineEnded);
          const creatorName = creatorLabel(project.ownerAddress, profileNames);
          const descriptionExpanded = expandedProjects.includes(project.id);
          const canExpandDescription = project.description.length > 180 || project.description.includes("\n");
          const contributionAmounts = projectContributionAmounts(project);
          return <article key={project.id} className={`flex flex-col rounded-3xl border p-6 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.45)] ${completed ? "border-moss/25 bg-moss/5" : "border-ink/10 bg-white/80"}`}>
          <div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex flex-wrap gap-2"><p className="w-fit rounded-full bg-moss/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-moss">Created by {project.ownerAddress ? <a href={`https://gnosisscan.io/address/${project.ownerAddress}`} target="_blank" rel="noreferrer" className="underline decoration-moss/40 underline-offset-2">{creatorName}</a> : "early demo"}</p>{completed && <p className="w-fit rounded-full bg-indigo px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white">{withdrawn ? "Funds withdrawn" : goalReached ? "Goal reached" : "Deadline ended"}</p>}</div><h3 className="font-display text-2xl font-bold tracking-tight">{project.title}</h3><p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink/50"><MapPin className="h-3.5 w-3.5" />{project.location}</p></div><div className="rounded-2xl bg-moss/10 p-3 text-moss"><Leaf className="h-5 w-5" /></div></div>
          <div className="mt-4">
            <p className={`whitespace-pre-line text-sm leading-6 text-ink/60 ${!descriptionExpanded ? "max-h-24 overflow-hidden" : ""}`}>{project.description}</p>
            {canExpandDescription && <button type="button" className="mt-2 text-xs font-bold uppercase tracking-wider text-indigo" onClick={() => setExpandedProjects((current) => current.includes(project.id) ? current.filter((id) => id !== project.id) : [...current, project.id])}>{descriptionExpanded ? "Show less" : "See more"}</button>}
          </div>
          <div className="mt-6"><div className="mb-2 flex items-end justify-between"><p className="font-display text-xl font-bold">{project.raised} <span className="text-sm text-ink/45">/ {project.goal} CRC</span></p><p className="text-xs font-semibold text-ink/50">{project.contributors} contributors</p></div><div className="h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-moss transition-all" style={{ width: `${Math.min(100, (project.raised / project.goal) * 100)}%` }} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2">{project.milestones.map((milestone) => { const unlocked = project.raised >= milestone.amount; return <div key={milestone.amount} className={`rounded-xl border p-2.5 ${unlocked ? "border-moss/25 bg-moss/5 text-moss" : "border-ink/10 text-ink/35"}`}><p className="text-[10px] font-bold uppercase tracking-wider">{milestone.amount} CRC</p><p className="mt-1 text-xs font-medium">{milestone.label}</p></div>; })}</div>
          </div>
          {completed ? <div className="mt-6 rounded-2xl border border-moss/20 bg-white/70 p-4 text-sm leading-6 text-ink/65"><p>{withdrawn ? "This project has been completed and the creator withdrew the funds." : goalReached ? "Goal reached. Contributions are closed; the creator can now withdraw the escrowed CRC." : "The funding window ended. Contributions are closed; the creator can withdraw the escrowed CRC."}</p>{withdrawn && project.withdrawNote?.trim() && <div className="mt-3 rounded-xl bg-sand/70 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-ink/40">Creator update</p><p className="mt-1 text-ink/70">{project.withdrawNote}</p></div>}</div> : <div className="mt-6 flex gap-2">{contributionAmounts.map((amount, index) => <Button key={amount} variant={index === 0 ? "default" : "outline"} size="sm" onClick={() => openCheckout({ kind: "project", item: project, amount })}>+{amount} CRC</Button>)}</div>}
          <Button className="mt-3 w-full" variant="outline" onClick={() => copyInviteLink(project.id)}><UserPlus className="h-4 w-4" />{inviteState === "copied" ? "Invite copied" : inviteState === "error" ? "Copy failed" : completed ? "Share completed project" : "Invite someone to fund"}</Button>
          {ownerMatches && <Button className="mt-3 w-full" variant={withdrawable ? "default" : "outline"} disabled={!withdrawable} onClick={() => { setWithdrawProject(project); setWithdrawNote(""); setWithdrawError(""); setWithdrawState("idle"); }}>Manage my project</Button>}
        </article>;
        })}</div>
        {projects.length === 0 && <div className="mt-8 rounded-3xl border border-dashed border-ink/15 bg-white/70 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo/10 text-indigo"><UserPlus className="h-5 w-5" /></div>
          <h3 className="mt-4 font-display text-2xl font-bold tracking-tight">No funded projects yet</h3>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-ink/60">Invite someone to create a project in Circles Commons. The link opens the app inside the Circles Playground so their Gnosis App wallet can connect.</p>
          <Button className="mt-5" variant="outline" onClick={() => copyInviteLink()}><UserPlus className="h-4 w-4" />{inviteState === "copied" ? "Invite copied" : inviteState === "error" ? "Copy failed" : "Invite someone to create a project"}</Button>
        </div>}
      </div></section>

      <section id="activity" className="border-t border-ink/10 bg-indigo px-5 py-14 text-white md:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Visible circulation</p>
            <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">CRC at work in the neighborhood.</h2>
            <p className="mt-4 text-sm leading-6 text-white/65">Funded project activity is read from the escrow contract. Website visits show overall traffic, while referral metrics track invite links opened inside the Playground.</p>
            <div className="mt-6 grid grid-cols-3 gap-2">
              <Metric value={String(referralMetrics.wallets)} label="invited wallets" />
              <Metric value={String(websiteVisits)} label="website visits" />
              <Metric value={String(referralMetrics.inviteSources)} label="invite sources" />
            </div>
            <p className="mt-3 text-xs leading-5 text-white/45">This counter mirrors site visits, invited wallets and invite sources.</p>
          </div>
          <div className="space-y-2">
            {activity.length ? activity.map((item) => <a key={item.hash} href={`https://gnosis.blockscout.com/tx/${item.hash}`} target={isMiniappHost ? "_top" : "_blank"} rel="noreferrer" className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm transition hover:border-white/25 hover:bg-white/15"><div><p className="font-medium">{item.text}</p><p className="mt-1 text-xs text-white/45">{item.time} · View transaction</p></div><span className="whitespace-nowrap font-display font-bold text-mint">{item.amount}</span></a>) : <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-5 text-sm text-white/60">No escrow funding activity yet.</div>}
          </div>
        </div>
      </section>

      {showProjectForm && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Funded project</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Create a project</h2></div><button type="button" onClick={() => setShowProjectForm(false)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close project form"><X className="h-4 w-4" /></button></div>
        <p className="mt-4 text-sm leading-6 text-ink/60">Your connected Gnosis App wallet becomes the project owner. Creation writes the project on-chain in the escrow, then saves the public metadata.</p>
        <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Owner wallet</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{hostWalletAddress ?? "Open in Playground to connect"}</p><p className="mt-2 text-xs font-bold uppercase tracking-wider text-ink/45">Escrow contract</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{escrowAddress ?? "Not configured yet"}</p></div>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Project title<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Community garden, tool library..." className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="What will this project fund?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Location<input value={projectLocation} onChange={(event) => setProjectLocation(event.target.value)} placeholder="Where it happens" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Goal in CRC<input value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} placeholder="50" inputMode="decimal" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label></div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink/40">Milestones</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={projectMilestoneOne} onChange={(event) => setProjectMilestoneOne(event.target.value)} placeholder="First step" className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneTwo} onChange={(event) => setProjectMilestoneTwo(event.target.value)} placeholder="Halfway" className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneThree} onChange={(event) => setProjectMilestoneThree(event.target.value)} placeholder="Completed" className="rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /></div>
        {projectError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{projectError}</p>}
        <Button className="mt-5 w-full" onClick={submitProject} disabled={!hostWalletAddress}><Plus className="h-4 w-4" />Create funded project</Button>
        <p className="mt-3 text-center text-[11px] leading-5 text-ink/45">Projects unlock withdrawal after 14 days or once the goal is reached.</p>
      </div></div>}

      {false && showCommunityPicker && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Organization directory</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose a Circles Organization</h2><p className="mt-2 text-sm leading-6 text-ink/60">Projects, contributions and admin actions change with the selected Organization.</p></div><button type="button" onClick={() => setShowCommunityPicker(false)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close Organization directory"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 space-y-3">{organizationTreasuries.map((community) => { const selected = community.address.toLowerCase() === recipientAddress.toLowerCase(); const kindLabel = "Circles Organization"; return <button key={community.address} type="button" onClick={() => selectCommunity(community.address)} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? "border-indigo/30 bg-indigo/5 shadow-[0_12px_25px_-22px_rgba(37,27,159,0.55)]" : "border-ink/10 bg-white/80 hover:border-indigo/25"}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-bold tracking-tight">{community.name}</p><span className="rounded-full bg-indigo/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo">{kindLabel}</span></div><p className="mt-2 text-sm leading-6 text-ink/60">{community.description || "A Circles Organization for local projects."}</p></div>{selected && <span className="rounded-full bg-indigo p-1 text-white"><Check className="h-3.5 w-3.5" /></span>}</div><div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink/40"><span className="font-mono">{shortAddress(community.address)}</span><span>treasury address {shortAddress(community.treasuryAddress ?? community.address)}</span></div></button>; })}</div>
        {!isMiniappHost && <Button variant="outline" className="mt-5 w-full" onClick={() => { setShowCommunityPicker(false); setCommunityStep("idle"); setCommunityName(""); setCommunityDescription(""); setCommunityError(""); setCommunityModal("create"); }}><Plus className="h-4 w-4" />Create Organization</Button>}
      </div></div>}

      {false && showJoin && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="w-full max-w-lg rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Membership</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Join {activeCommunity?.name ?? "this community"}</h2></div><button type="button" onClick={() => setShowJoin(false)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close membership request"><X className="h-4 w-4" /></button></div>
        {joinSubmitted ? <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Request sent</h3><p className="mt-2 text-sm leading-6 text-ink/60">A community admin can now approve your membership. Once approved, you can contribute CRC to shared projects.</p><Button className="mt-6" onClick={() => setShowJoin(false)}>Done</Button></div> : <>
          <p className="mt-4 text-sm leading-6 text-ink/60">{isMiniappHost ? "Your Circles account is provided securely by Gnosis App. Submit a request and a community admin can approve it." : "Standalone cannot securely connect Gnosis App yet. Enter your Circles address manually, or open the embedded mini-app for verified wallet injection."}</p>
          {isMiniappHost ? <div className="mt-5 rounded-2xl border border-moss/20 bg-moss/5 p-4"><p className="text-xs font-bold uppercase tracking-wider text-moss">Gnosis App account</p><p className="mt-2 break-all font-mono text-xs text-ink/65">{hostWalletAddress ?? "Waiting for your Gnosis App account..."}</p></div> : <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-ink/50">Your Gnosis App Circles address<input value={joinAddress} onChange={(event) => setJoinAddress(event.target.value)} placeholder="0x Circles address" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 font-mono text-xs font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>}
          <Button className="mt-5 w-full" onClick={requestMembership} disabled={isMiniappHost ? !hostWalletAddress : !joinAddress.trim()}><UserPlus className="h-4 w-4" />Request membership</Button>
          <p className="mt-3 text-center text-[11px] leading-5 text-ink/45">Requests are shared with the selected community. Approval is a real Circles transaction.</p>
        </>}
      </div></div>}

      {showServiceForm && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Member service</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Offer a service in {activeCommunity?.name ?? "this community"}</h2></div><button type="button" onClick={() => setShowServiceForm(false)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close service form"><X className="h-4 w-4" /></button></div>
        <p className="mt-4 text-sm leading-6 text-ink/60">Members book your service and pay CRC directly to your Circles address. The community only lists the offer.</p>
        <label className="mt-5 block text-xs font-bold uppercase tracking-wider text-ink/50">Service title<input value={serviceTitle} onChange={(event) => setServiceTitle(event.target.value)} placeholder="Bike repair, language practice, cooking help..." className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={serviceDescription} onChange={(event) => setServiceDescription(event.target.value)} placeholder="What do you offer, and for whom is it useful?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Your name<input value={serviceProvider} onChange={(event) => setServiceProvider(event.target.value)} placeholder="Name shown on the card" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Duration<input value={serviceDuration} onChange={(event) => setServiceDuration(event.target.value)} placeholder="45 min, 1 hour..." className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label></div>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Price in CRC<input value={servicePrice} onChange={(event) => setServicePrice(event.target.value)} placeholder="10" inputMode="decimal" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
        {isMiniappHost ? <div className="mt-4 rounded-2xl border border-moss/20 bg-moss/5 p-4"><p className="text-xs font-bold uppercase tracking-wider text-moss">Payment address from Gnosis App</p><p className="mt-2 break-all font-mono text-xs text-ink/65">{hostWalletAddress ?? "Waiting for your Gnosis App account..."}</p></div> : <><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Your Circles payment address<input value={serviceProviderAddress} onChange={(event) => setServiceProviderAddress(event.target.value)} placeholder="0x address that receives CRC" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 font-mono text-xs font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><p className="mt-2 text-[11px] leading-5 text-ink/45">Standalone posting is manual. For verified wallet ownership, open Circles Commons as an embedded mini-app in Gnosis App.</p></>}
        {serviceError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{serviceError}</p>}
        <Button className="mt-5 w-full" onClick={submitService} disabled={isMiniappHost ? !hostWalletAddress : !serviceProviderAddress.trim()}><Plus className="h-4 w-4" />Publish service</Button>
      </div></div>}

      {false && communityModal && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Circles Organization</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{communityModal === "create" ? "Create Organization" : `Manage ${activeCommunity?.name ?? "Organization"}`}</h2></div><button type="button" onClick={() => setCommunityModal(null)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close Organization panel"><X className="h-4 w-4" /></button></div>
        {communityModal === "create" ? communityStep === "created" ? <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Organization created</h3><p className="mt-2 text-sm leading-6 text-ink/60">Your Circles Organization is registered and selected. Projects can now receive CRC into its treasury address.</p><div className="mt-5 rounded-2xl border border-moss/20 bg-moss/5 p-3 text-left"><p className="text-xs font-bold uppercase tracking-wider text-moss">Organization address</p><p className="mt-2 break-all font-mono text-xs text-ink/70">{organizationAddress}</p></div><Button className="mt-6" onClick={() => { setCommunityStep("idle"); setCommunityModal("manage"); }}>Manage Organization</Button></div> : <>
          <p className="mt-4 text-sm leading-6 text-ink/60">Create a Circles Organization on Gnosis Chain. Its address becomes the shared treasury address for local funded projects and requires Rabby or MetaMask with xDAI for gas.</p>
          <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Signing wallet</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{connectedWallet || "Connect Rabby or MetaMask on Gnosis Chain"}</p></div><Wallet className="h-5 w-5 shrink-0 text-indigo" /></div><Button variant="outline" className="mt-3 w-full" onClick={connectWallet} disabled={communityStep === "connecting"}>{communityStep === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}{connectedWallet ? "Reconnect wallet" : "Connect wallet"}</Button></div>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Organization name<input value={communityName} onChange={(event) => setCommunityName(event.target.value)} placeholder="e.g. Commons Lab" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={communityDescription} onChange={(event) => setCommunityDescription(event.target.value)} placeholder="What will this Organization fund?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
          {communityError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{communityError}</p>}
          <Button className="mt-5 w-full" onClick={createCommunity} disabled={!communityName.trim() || communityStep === "registering"}>{communityStep === "registering" && <Loader2 className="h-4 w-4 animate-spin" />}{communityStep === "registering" ? "Confirm in your wallet" : "Register Organization"}</Button>
          <p className="mt-3 text-center text-[11px] leading-5 text-ink/45">This sends an on-chain transaction. Your wallet needs a small amount of xDAI for gas.</p>
        </> : <>
          <p className="mt-4 text-sm leading-6 text-ink/60">Only the configured admin wallet can approve contributors and pay out funds in this MVP. For newly created Organizations, the admin is the wallet that created it.</p>
          <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Expected admin wallet</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{communityAdminAddress || "No admin configured"}</p><p className="mt-2 text-xs font-bold uppercase tracking-wider text-ink/45">Connected wallet</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{connectedWallet || "Connect the admin wallet"}</p></div><Wallet className="h-5 w-5 shrink-0 text-indigo" /></div><Button variant="outline" className="mt-3 w-full" onClick={connectWallet} disabled={communityStep === "connecting"}>{communityStep === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}{connectedWallet ? "Reconnect wallet" : "Connect admin wallet"}</Button></div>
          {connectedWallet && !isConnectedAdmin && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">This wallet is not the configured admin for this Organization. Treasury actions remain locked.</p>}
          {isConnectedAdmin && !canAdminSendTreasuryTransactions && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">This Organization has a separate admin address, but this MVP can only send treasury transactions when the admin wallet is the treasury address itself.</p>}
          {isConnectedAdmin && <><div className="mt-4 rounded-2xl border border-ink/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/50">Approve contributors</p><p className="mt-2 text-xs leading-5 text-ink/55">Approved contributors can send personal CRC to this treasury. Approval is recorded on-chain.</p>{membershipRequests.length > 0 && <div className="mt-3 space-y-2">{membershipRequests.map((request) => { const approved = approvedAddresses.includes(request.address.toLowerCase()); return <div key={request.address} className="rounded-xl border border-moss/15 bg-moss/5 p-3"><p className="break-all font-mono text-xs text-ink/65">{request.address}</p><p className="mt-1 text-[10px] text-ink/40">Requested {new Date(request.requestedAt).toLocaleDateString()}</p><Button size="sm" variant={approved ? "outline" : "default"} className="mt-2 w-full" onClick={() => addMemberTrust(request.address)} disabled={!canAdminSendTreasuryTransactions || approved || trustState === "adding"}>{trustState === "adding" && <Loader2 className="h-4 w-4 animate-spin" />}{approved ? "Already approved" : "Approve contributor"}</Button></div>; })}</div>}<p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink/40">Add an address directly</p><input value={memberAddress} onChange={(event) => setMemberAddress(event.target.value)} placeholder="0x contributor Circles address" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 font-mono text-xs outline-none transition focus:border-indigo/45" /><Button variant="outline" className="mt-3 w-full" onClick={() => addMemberTrust()} disabled={!canAdminSendTreasuryTransactions || !memberAddress.trim() || trustState === "adding" || approvedAddresses.includes(memberAddress.trim().toLowerCase())}>{trustState === "adding" && <Loader2 className="h-4 w-4 animate-spin" />}{approvedAddresses.includes(memberAddress.trim().toLowerCase()) ? "Already approved" : trustState === "adding" ? "Confirm in your wallet" : "Approve address"}</Button></div>
          <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/50">Create a funded project</p><p className="mt-2 text-xs leading-5 text-ink/55">Projects are funding proposals inside this Organization. Contributions go to its treasury address.</p><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Project title<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Community garden, tool library..." className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="What will this project fund?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Location<input value={projectLocation} onChange={(event) => setProjectLocation(event.target.value)} placeholder="Where it happens" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Goal in CRC<input value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} placeholder="50" inputMode="decimal" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label></div><p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink/40">Milestones</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={projectMilestoneOne} onChange={(event) => setProjectMilestoneOne(event.target.value)} placeholder="First step" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneTwo} onChange={(event) => setProjectMilestoneTwo(event.target.value)} placeholder="Halfway" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneThree} onChange={(event) => setProjectMilestoneThree(event.target.value)} placeholder="Completed" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /></div>{projectError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{projectError}</p>}<Button className="mt-4 w-full" onClick={submitProject}><Plus className="h-4 w-4" />Create project</Button></div>
          <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/50">Pay out Organization funds</p><p className="mt-2 text-xs leading-5 text-ink/55">Send CRC from this Organization treasury address to a project supplier, organizer, or contributor.</p><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Recipient address<input value={payoutRecipient} onChange={(event) => setPayoutRecipient(event.target.value)} placeholder="0x recipient Circles address" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 font-mono text-xs font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Amount CRC<input value={payoutAmount} onChange={(event) => setPayoutAmount(event.target.value)} placeholder="25" inputMode="decimal" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Memo<input value={payoutMemo} onChange={(event) => setPayoutMemo(event.target.value)} placeholder="garden tools payout" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label></div>{payoutError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{payoutError}</p>}{payoutState === "sent" && <p className="mt-3 rounded-xl bg-moss/10 p-3 text-xs leading-5 text-moss">Payout submitted. Activity will update from the Circles RPC.</p>}<Button className="mt-4 w-full" onClick={submitPayout} disabled={!canAdminSendTreasuryTransactions || !payoutRecipient.trim() || !payoutAmount.trim() || payoutState === "sending"}>{payoutState === "sending" && <Loader2 className="h-4 w-4 animate-spin" />}{payoutState === "sending" ? "Confirm payout" : "Pay out CRC"}</Button></div></>}
        </>}
      </div></div>}

      {withdrawProject && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Manage my project</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{withdrawProject.title}</h2></div><button type="button" onClick={() => setWithdrawProject(null)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close withdraw panel"><X className="h-4 w-4" /></button></div>
        {withdrawState === "submitted" ? <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Withdrawal submitted</h3><p className="mt-2 text-sm leading-6 text-ink/60">The escrowed CRC were sent to your project owner wallet.</p><Button className="mt-6" onClick={() => setWithdrawProject(null)}>Back to projects</Button></div> : <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-white/70 p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Raised</p><p className="mt-1 font-display text-2xl font-bold">{withdrawProject.raised} / {withdrawProject.goal} CRC</p></div><div className="rounded-2xl bg-white/70 p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Unlock rule</p><p className="mt-1 text-sm leading-6 text-ink/60">Goal reached or 14-day deadline passed.</p></div></div>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Update note<textarea value={withdrawNote} onChange={(event) => setWithdrawNote(event.target.value)} placeholder="Thanks, funds will be used for..." rows={4} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
          {withdrawError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{withdrawError}</p>}
          <Button className="mt-5 w-full" onClick={submitWithdraw} disabled={withdrawState === "submitting"}>{withdrawState === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}{withdrawState === "submitting" ? "Approve withdrawal" : "Withdraw funds"}</Button>
        </>}
      </div></div>}

      {checkout && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">{checkout.kind === "service" ? "Book a service" : "Fund this project"}</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{checkout.item.title}</h2></div><button type="button" onClick={closeCheckout} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close checkout"><X className="h-4 w-4" /></button></div>
        {status === "confirmed" ? <div className="py-10 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Payment confirmed</h3><p className="mt-2 text-sm leading-6 text-ink/60">{checkout.amount} CRC were sent to {checkout.kind === "project" ? "the escrow contract" : "the service provider"}.</p><Button className="mt-6" onClick={closeCheckout}>Back to Commons</Button></div> : <>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-white p-4"><span className="text-sm font-medium text-ink/55">Amount to pay</span><span className="font-display text-2xl font-bold">{checkout.amount} CRC</span></div>
          <div className="mt-3 rounded-2xl border border-ink/10 bg-sand/60 p-3 text-xs text-ink/55"><p className="font-semibold text-ink/70">Unique payment reference</p><p className="mt-1 font-mono">{reference.slice(0, 27)}...</p></div>
          {!checkoutRecipientAddress && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">No payment recipient is configured for this checkout.</p>}
          {checkout.kind === "service" && <div className="mt-3 rounded-2xl border border-ink/10 bg-white/70 p-3 text-xs text-ink/55"><p className="font-semibold text-ink/70">Recipient</p><p className="mt-1">This CRC payment goes directly to {checkout.item.provider}, not to the project escrow.</p><p className="mt-1 break-all font-mono">{checkout.item.providerAddress}</p></div>}
          {isMiniappHost ? <><div className="mt-4"><Button className="w-full" disabled={!hostWalletAddress || !checkoutRecipientAddress || embeddedPaymentState === "submitting"} onClick={payInsideGnosisApp}>{embeddedPaymentState === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}{embeddedPaymentState === "submitting" ? "Approve in Gnosis App" : "Pay with Gnosis App"}</Button>{embeddedPaymentState === "submitted" && <p className="mt-3 rounded-xl bg-moss/10 p-3 text-xs leading-5 text-moss">Transaction submitted. Waiting for on-chain confirmation.</p>}{embeddedPaymentState === "error" && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{embeddedPaymentError || "The transaction was not submitted. You can try again."}</p>}</div><div className="mt-4 rounded-2xl border border-ink/10 bg-white/70 p-4"><PaymentStatus status={status} payment={payment} error={error} /><Button variant={watching ? "outline" : "default"} disabled={!paymentLink} className="mt-4 w-full" onClick={() => setWatching((current) => !current)}>{watching ? "Stop monitoring" : "I paid, check payment"}</Button></div></> : <><p className="mt-4 rounded-xl bg-indigo/10 p-3 text-xs leading-5 text-indigo">To pay with your Gnosis App wallet, open this mini-app inside the Circles Playground.</p><Button asChild className="mt-4 w-full"><a href={playgroundLink} target="_blank" rel="noreferrer">Open in Circles Playground <ArrowUpRight className="h-4 w-4" /></a></Button></>}
        </>}
      </div></div>}
      <footer className="border-t border-ink/10 px-5 py-6 text-center text-xs text-ink/40 md:px-8">
        Created by <a href="https://x.com/miragetheplug" target="_blank" rel="noreferrer" className="font-semibold text-ink/55 underline decoration-ink/20 underline-offset-4 transition hover:text-ink">Mirage</a>
        <span className="mx-2">·</span>
        <a href="https://github.com/plugmirage/circles-commons" target="_blank" rel="noreferrer" className="font-semibold text-ink/55 underline decoration-ink/20 underline-offset-4 transition hover:text-ink">GitHub</a>
      </footer>
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-2xl bg-sand/60 p-3"><p className="font-display text-xl font-bold">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-ink/45">{label}</p></div>;
}
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-coral">{eyebrow}</p><h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{title}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/60">{description}</p></div>;
}
