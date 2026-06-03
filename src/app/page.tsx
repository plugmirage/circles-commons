"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  ArrowRight, ArrowUpRight, Bike, Building2, Check, CheckCircle2, ChevronDown, Clipboard, Clock3,
  HandHeart, Leaf, Loader2, MapPin, Plus, QrCode, Sparkles, UserPlus, Users, Wallet, Wrench, X
} from "lucide-react";

import { PaymentStatus } from "@/components/payment-status";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/wallet-provider";
import { usePaymentWatcher } from "@/hooks/use-payment-watcher";
import { circlesConfig, decodeTransferData, fetchTransferDataEvents, generatePaymentLink } from "@/lib/circles";
import { connectCommunityWallet, isCommunityMemberApproved, registerCommunity, trustCommunityMember } from "@/lib/community";
import { loadCommunities, loadMembershipRequests, loadProjects, loadServices, publishProject, publishService, registerCommunityMetadata, removeMembershipRequest, requestMembership as persistMembershipRequest, type MembershipRequest, type StoredCommunity, type StoredProject, type StoredService } from "@/lib/commons-storage";

type Service = StoredService & { icon: typeof Bike; tone: string };
type Project = StoredProject & { raised: number; contributors: number };
type Checkout =
  | { kind: "service"; item: Service; amount: number }
  | { kind: "project"; item: Project; amount: number };
type Activity = { hash: string; text: string; amount: string; time: string };
const ACTIVE_COMMUNITY_STORAGE_KEY = "circles-commons-active-community";
const defaultCommunities: StoredCommunity[] = circlesConfig.defaultRecipientAddress ? [{
  address: circlesConfig.defaultRecipientAddress,
  name: "Commons Lab",
  description: "A community treasury for funding local projects and useful services with CRC.",
  kind: "organization",
  treasuryAddress: circlesConfig.defaultRecipientAddress,
  source: "created"
}] : [];

const initialProjects: Project[] = [
  { id: "garden", title: "Community garden", description: "Turn an unused courtyard into a shared garden with herbs and raised beds.", location: "Rue des Lilas courtyard", raised: 0, goal: 50, contributors: 0, milestones: [{ amount: 10, label: "Tools" }, { amount: 25, label: "First raised bed" }, { amount: 50, label: "Full garden" }] },
  { id: "repair-cafe", title: "Monthly repair cafe", description: "Fund tools and spare parts for a monthly neighbor-led repair afternoon.", location: "Commons workshop", raised: 0, goal: 50, contributors: 0, milestones: [{ amount: 10, label: "Starter toolkit" }, { amount: 25, label: "Spare parts" }, { amount: 50, label: "Three events" }] }
];
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
  const [projects, setProjects] = useState(initialProjects);
  const [projectDefinitions, setProjectDefinitions] = useState<StoredProject[]>(initialProjects);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [reference, setReference] = useState("");
  const [watching, setWatching] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrCode, setQrCode] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [embeddedPaymentState, setEmbeddedPaymentState] = useState<"idle" | "submitting" | "submitted" | "error">("idle");
  const [appliedReference, setAppliedReference] = useState("");
  const [communityModal, setCommunityModal] = useState<"create" | "manage" | null>(null);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showCommunityPicker, setShowCommunityPicker] = useState(false);
  const [communityName, setCommunityName] = useState("");
  const [communityDescription, setCommunityDescription] = useState("");
  const [groupAddress, setGroupAddress] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
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
  const [memberAddress, setMemberAddress] = useState("");
  const [trustState, setTrustState] = useState<"idle" | "adding" | "added">("idle");
  const [approvedAddresses, setApprovedAddresses] = useState<string[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [showJoin, setShowJoin] = useState(false);
  const [joinAddress, setJoinAddress] = useState("");
  const [membershipRequests, setMembershipRequests] = useState<MembershipRequest[]>([]);
  const [joinSubmitted, setJoinSubmitted] = useState(false);
  const [rpcMetrics, setRpcMetrics] = useState({ crc: 0, transactions: 0, projects: 0 });
  const [rpcRefresh, setRpcRefresh] = useState(0);

  const recipientAddress = activeCommunityAddress;
  const activeCommunity = communities.find((community) => community.address.toLowerCase() === recipientAddress.toLowerCase());
  const communityTreasuryAddress = activeCommunity?.treasuryAddress ?? recipientAddress;
  const isActiveCommunityGroup = activeCommunity?.kind === "group";
  const activeCommunityKindLabel = isActiveCommunityGroup ? "Circles Group" : "Circles Organization";
  const isConnectedAdmin = Boolean(recipientAddress && connectedWallet && recipientAddress.toLowerCase() === connectedWallet.toLowerCase());
  const checkoutRecipientAddress = checkout?.kind === "service" ? checkout.item.providerAddress : communityTreasuryAddress;
  const paymentLink = useMemo(() => checkout && reference && checkoutRecipientAddress
    ? generatePaymentLink(checkoutRecipientAddress, checkout.amount, reference)
    : "", [checkout, checkoutRecipientAddress, reference]);
  const { status, payment, error } = usePaymentWatcher({
    enabled: watching && Boolean(checkout), dataValue: reference,
    minAmountCRC: checkout?.amount ?? 0, recipientAddress: checkoutRecipientAddress
  });

  useEffect(() => {
    if (isMiniappHost) setJoinAddress(hostWalletAddress ?? "");
  }, [hostWalletAddress, isMiniappHost]);

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
      const selected = window.localStorage.getItem(ACTIVE_COMMUNITY_STORAGE_KEY);
      const next = stored.find((community) => community.address.toLowerCase() === selected?.toLowerCase()) ?? stored[0];
      if (next) setActiveCommunityAddress(next.address);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadMembershipRequests(recipientAddress).then(setMembershipRequests).catch(() => {});
  }, [recipientAddress]);

  useEffect(() => {
    loadProjects(recipientAddress, initialProjects).then((stored) => {
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
    if (isMiniappHost) setServiceProviderAddress(hostWalletAddress ?? "");
  }, [hostWalletAddress, isMiniappHost]);

  useEffect(() => {
    if (!recipientAddress) return;
    let active = true;
    (async () => {
      const activityRecipients = [communityTreasuryAddress, ...services.map((service) => service.providerAddress)]
        .filter((address, index, list) => address && list.findIndex((item) => item.toLowerCase() === address.toLowerCase()) === index);
      const eventBatches = await Promise.all(activityRecipients.map((address) => fetchTransferDataEvents(200, address)));
      const events = eventBatches.flat();
      const contributions: { id: string; amount: number; hash: string }[] = [];
      const nextActivity: Activity[] = [];
      for (const event of events) {
        const reference = parseReference(decodeTransferData(event.data));
        if (reference) {
          const project = projectDefinitions.find((item) => item.id === reference.id);
          const service = services.find((item) => item.id === reference.id);
          const label = reference.kind === "project"
            ? `funded ${project?.title ?? reference.id}`
            : `booked ${service?.title ?? reference.id}`;
          nextActivity.push({
            hash: event.transactionHash,
            text: `${shortAddress(event.from)} ${label}`,
            amount: `${reference.kind === "project" ? "+" : ""}${reference.amount} CRC`,
            time: "Confirmed on-chain"
          });
        }
        if (!reference || reference.kind !== "project") continue;
        contributions.push({ id: reference.id, amount: reference.amount, hash: event.transactionHash });
      }
      if (!active) return;
      setActivity(nextActivity.slice(0, 5));
      setProjects(projectDefinitions.map((project) => {
        const matching = contributions.filter((item) => item.id === project.id);
        const amount = matching.reduce((total, item) => total + item.amount, 0);
        return { ...project, raised: Math.min(project.goal, amount), contributors: matching.length };
      }));
      setRpcMetrics({
        crc: contributions.reduce((total, item) => total + item.amount, 0),
        transactions: events.length,
        projects: new Set(contributions.map((item) => item.id)).size
      });
    })().catch(() => {});
    return () => { active = false; };
  }, [communityTreasuryAddress, projectDefinitions, recipientAddress, rpcRefresh, services]);

  useEffect(() => {
    if (status !== "confirmed" || !checkout || appliedReference === reference) return;
    if (checkout.kind === "project") {
      setRpcRefresh((current) => current + 1);
    }
    setAppliedReference(reference);
  }, [appliedReference, checkout, payment?.transactionHash, reference, status]);

  const openCheckout = (next: Checkout) => {
    setCheckout(next); setReference(makeReference(next.kind, next.item.id, next.amount));
    setWatching(false); setShowQr(false); setQrCode(""); setCopyState("idle"); setEmbeddedPaymentState("idle");
  };
  const closeCheckout = () => { setCheckout(null); setReference(""); setWatching(false); setShowQr(false); };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(paymentLink); setCopyState("copied"); window.setTimeout(() => setCopyState("idle"), 1600); }
    catch { setCopyState("error"); }
  };
  const payInsideGnosisApp = async () => {
    if (!hostWalletAddress || !checkoutRecipientAddress || !checkout || !reference) return;
    setEmbeddedPaymentState("submitting");
    try {
      const { sendEmbeddedCrcPayment } = await import("@/lib/embedded-payments");
      await sendEmbeddedCrcPayment(hostWalletAddress, checkoutRecipientAddress, checkout.amount, reference);
      setEmbeddedPaymentState("submitted");
      setWatching(true);
    } catch {
      setEmbeddedPaymentState("error");
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
    if (!projectTitle.trim() || !projectDescription.trim() || !projectLocation.trim() || !Number.isFinite(goal) || goal <= 0) {
      setProjectError("Fill title, description, location and a valid CRC goal.");
      return;
    }
    const labels = [projectMilestoneOne, projectMilestoneTwo, projectMilestoneThree].map((label) => label.trim());
    if (labels.some((label) => !label)) {
      setProjectError("Add three milestone labels so contributors know what each threshold unlocks.");
      return;
    }
    const project: StoredProject = {
      id: crypto.randomUUID(),
      title: projectTitle.trim(),
      description: projectDescription.trim(),
      location: projectLocation.trim(),
      goal,
      milestones: [
        { amount: Math.max(1, Math.round(goal * 0.2)), label: labels[0] },
        { amount: Math.max(2, Math.round(goal * 0.5)), label: labels[1] },
        { amount: goal, label: labels[2] }
      ]
    };
    try {
      await publishProject(recipientAddress, project);
      setProjectDefinitions((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setProjects((current) => [{ ...project, raised: 0, contributors: 0 }, ...current.filter((item) => item.id !== project.id)]);
      resetProjectForm();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create this project.");
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
      const community = { name: communityName.trim(), description: communityDescription.trim(), address: created.address, kind: "organization" as const, treasuryAddress: created.address, source: "created" as const };
      await registerCommunityMetadata(community);
      setConnectedWallet(created.signer); setOrganizationAddress(created.address); setCommunityStep("created");
      setCommunities((current) => [...current.filter((item) => item.address.toLowerCase() !== created.address.toLowerCase()), community]);
      setActiveCommunityAddress(created.address);
      window.localStorage.setItem(ACTIVE_COMMUNITY_STORAGE_KEY, created.address);
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : "Organization registration failed."); setCommunityStep("idle");
    }
  };
  const activateGroup = async () => {
    if (!groupAddress.trim() || !groupName.trim()) return;
    setCommunityError("");
    const community = {
      address: groupAddress.trim(),
      name: groupName.trim(),
      description: groupDescription.trim() || "Existing Circles Group activated on Circles Commons.",
      kind: "group" as const,
      treasuryAddress: groupAddress.trim(),
      source: "activated" as const
    };
    try {
      await registerCommunityMetadata(community);
      setCommunities((current) => [...current.filter((item) => item.address.toLowerCase() !== community.address.toLowerCase()), community]);
      setActiveCommunityAddress(community.address);
      window.localStorage.setItem(ACTIVE_COMMUNITY_STORAGE_KEY, community.address);
      setGroupAddress("");
      setGroupName("");
      setGroupDescription("");
      setCommunityModal(null);
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : "Could not activate this group.");
    }
  };
  const addMemberTrust = async (address = memberAddress) => {
    if (!recipientAddress || !address.trim()) return;
    setCommunityError(""); setTrustState("adding");
    try {
      await trustCommunityMember(recipientAddress as `0x${string}`, address.trim() as `0x${string}`);
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
    if (!recipientAddress || !address.trim()) return;
    if (await isCommunityMemberApproved(recipientAddress as `0x${string}`, address.trim() as `0x${string}`)) {
      setApprovedAddresses((current) => [...new Set([...current, address.trim().toLowerCase()])]);
    }
  }, [recipientAddress]);
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
            <Image src="/logo-color.png" alt="Circles" width={120} height={36} className="h-7 w-auto" priority />
            <span className="h-6 w-px bg-ink/15" /><span className="font-display text-lg font-semibold tracking-tight">Commons</span>
          </div>
          <div className="hidden items-center gap-6 text-sm font-medium text-ink/60 sm:flex">
            <a href="#services">Services</a><a href="#projects">Projects</a><a href="#activity">Activity</a>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{isMiniappHost && <span className={`rounded-full px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider ${isHostWalletConnected ? "bg-moss/10 text-moss" : "bg-coral/10 text-coral"}`}>{isHostWalletConnected ? "Gnosis connected" : "Waiting for Gnosis"}</span>}<button type="button" onClick={() => setShowCommunityPicker(true)} className="flex max-w-36 items-center gap-1.5 rounded-full border border-ink/15 bg-white px-3 py-2 text-left text-xs font-semibold text-ink transition hover:border-indigo/35 sm:max-w-44"><Building2 className="h-3.5 w-3.5 shrink-0 text-indigo" /><span className="truncate">{activeCommunity?.name ?? "Choose community"}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink/40" /></button><Button size="sm" variant="ghost" onClick={() => { setJoinSubmitted(false); setShowJoin(true); }}><UserPlus className="h-4 w-4" />Join</Button>{!isMiniappHost && <><Button size="sm" variant="ghost" onClick={() => { setCommunityStep("idle"); setCommunityName(""); setCommunityDescription(""); setGroupAddress(""); setGroupName(""); setGroupDescription(""); setCommunityError(""); setCommunityModal("create"); }}><Plus className="h-4 w-4" />New</Button><Button size="sm" variant="outline" onClick={() => { setCommunityError(""); setCommunityModal("manage"); }}><Building2 className="h-4 w-4" />Manage</Button></>}</div>
        </nav>
      </header>

      <section className="px-5 pb-14 pt-14 md:px-8 md:pb-20 md:pt-20">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-moss/20 bg-moss/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-moss"><Sparkles className="h-3.5 w-3.5" />A neighborhood economy</p>
            <h1 className="max-w-3xl font-display text-5xl font-bold leading-[1.02] tracking-[-0.06em] sm:text-6xl">Spend locally.<br /><span className="text-indigo">Build together.</span></h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-ink/65">Use your CRC for useful services from neighbors and fund the shared projects that make your community thrive.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg"><a href="#services">Explore services <ArrowRight className="h-4 w-4" /></a></Button>
              <Button asChild size="lg" variant="outline"><a href="#projects">Fund a project</a></Button>
            </div>
          </div>
          <div className="rounded-[2rem] border border-ink/10 bg-white/75 p-6 shadow-[0_24px_60px_-32px_rgba(37,27,159,0.35)]">
            <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-ink/45">Selected community</p><p className="mt-2 font-display text-3xl font-bold tracking-tight">{activeCommunity?.name ?? "Choose a community"}</p><div className="mt-2 flex flex-wrap gap-2"><p className="w-fit rounded-full bg-indigo/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo">{activeCommunityKindLabel}</p>{activeCommunity?.source === "activated" && <p className="w-fit rounded-full bg-moss/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-moss">Activated on Commons</p>}</div><p className="mt-2 text-xs leading-5 text-ink/50">{activeCommunity?.description ?? "Choose a community to see its member services and internal projects."}</p><p className="mt-2 text-[11px] leading-5 text-ink/40">Project payments go to {shortAddress(communityTreasuryAddress)}. Service payments go directly to the service provider.</p></div><div className="rounded-2xl bg-moss/10 p-3 text-moss"><HandHeart className="h-6 w-6" /></div></div>
            <div className="mt-7 grid grid-cols-3 gap-3"><Metric value={String(rpcMetrics.crc)} label="CRC funded" /><Metric value={String(rpcMetrics.transactions)} label="on-chain exchanges" /><Metric value={String(rpcMetrics.projects)} label="funded projects" /></div>
            <div className="mt-6 rounded-2xl bg-sand/65 p-4 text-sm leading-6 text-ink/65">CRC moves where it is useful: from neighbors, to local services, to projects everyone can enjoy.</div>
          </div>
        </div>
      </section>

      <section id="services" className="border-y border-ink/10 bg-white/55 px-5 py-14 md:px-8 md:py-20">
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

      <section id="projects" className="px-5 py-14 md:px-8 md:py-20"><div className="mx-auto max-w-6xl"><SectionHeading eyebrow="Projects inside this community" title={`Projects in ${activeCommunity?.name ?? "the selected community"}`} description="These are not separate communities. They are funding proposals owned by the selected community treasury." />
        <div className="mt-8 grid gap-5 md:grid-cols-2">{projects.map((project) => <article key={project.id} className="rounded-3xl border border-ink/10 bg-white/80 p-6 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.45)]">
          <div className="flex items-start justify-between gap-4"><div><p className="mb-2 w-fit rounded-full bg-moss/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-moss">Project in {activeCommunity?.name ?? "community"}</p><h3 className="font-display text-2xl font-bold tracking-tight">{project.title}</h3><p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink/50"><MapPin className="h-3.5 w-3.5" />{project.location}</p></div><div className="rounded-2xl bg-moss/10 p-3 text-moss"><Leaf className="h-5 w-5" /></div></div>
          <p className="mt-4 text-sm leading-6 text-ink/60">{project.description}</p>
          <div className="mt-6"><div className="mb-2 flex items-end justify-between"><p className="font-display text-xl font-bold">{project.raised} <span className="text-sm text-ink/45">/ {project.goal} CRC</span></p><p className="text-xs font-semibold text-ink/50">{project.contributors} contributors</p></div><div className="h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-moss transition-all" style={{ width: `${Math.min(100, (project.raised / project.goal) * 100)}%` }} /></div>
            <div className="mt-4 grid grid-cols-3 gap-2">{project.milestones.map((milestone) => { const unlocked = project.raised >= milestone.amount; return <div key={milestone.amount} className={`rounded-xl border p-2.5 ${unlocked ? "border-moss/25 bg-moss/5 text-moss" : "border-ink/10 text-ink/35"}`}><p className="text-[10px] font-bold uppercase tracking-wider">{milestone.amount} CRC</p><p className="mt-1 text-xs font-medium">{milestone.label}</p></div>; })}</div>
          </div>
          <div className="mt-6 flex gap-2">{[10, 25, 50].map((amount) => <Button key={amount} variant={amount === 10 ? "default" : "outline"} size="sm" onClick={() => openCheckout({ kind: "project", item: project, amount })}>+{amount} CRC</Button>)}</div>
        </article>)}</div>
      </div></section>

      <section id="activity" className="border-t border-ink/10 bg-indigo px-5 py-14 text-white md:px-8"><div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[0.8fr_1.2fr] md:items-center"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Visible circulation</p><h2 className="mt-3 font-display text-3xl font-bold tracking-tight">CRC at work in the neighborhood.</h2><p className="mt-4 text-sm leading-6 text-white/65">These contributions are read directly from the Circles RPC.</p></div><div className="space-y-2">{activity.length ? activity.map((item) => <div key={item.hash} className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm"><div><p className="font-medium">{item.text}</p><p className="mt-1 text-xs text-white/45">{item.time}</p></div><span className="whitespace-nowrap font-display font-bold text-mint">{item.amount}</span></div>) : <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-5 text-sm text-white/60">No on-chain Commons activity yet.</div>}</div></div></section>

      {showCommunityPicker && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Community directory</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">Choose your community</h2><p className="mt-2 text-sm leading-6 text-ink/60">Projects, membership requests and the treasury change with the selected community.</p></div><button type="button" onClick={() => setShowCommunityPicker(false)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close community directory"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 space-y-3">{communities.map((community) => { const selected = community.address.toLowerCase() === recipientAddress.toLowerCase(); const kindLabel = community.kind === "group" ? "Circles Group" : "Circles Organization"; return <button key={community.address} type="button" onClick={() => selectCommunity(community.address)} className={`w-full rounded-2xl border p-4 text-left transition ${selected ? "border-indigo/30 bg-indigo/5 shadow-[0_12px_25px_-22px_rgba(37,27,159,0.55)]" : "border-ink/10 bg-white/80 hover:border-indigo/25"}`}><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><p className="font-display text-lg font-bold tracking-tight">{community.name}</p><span className="rounded-full bg-indigo/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo">{kindLabel}</span></div><p className="mt-2 text-sm leading-6 text-ink/60">{community.description || "A Circles community treasury for local projects and useful exchanges."}</p></div>{selected && <span className="rounded-full bg-indigo p-1 text-white"><Check className="h-3.5 w-3.5" /></span>}</div><div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink/40"><span className="font-mono">{shortAddress(community.address)}</span><span>treasury {shortAddress(community.treasuryAddress ?? community.address)}</span>{community.source === "activated" && <span>activated group</span>}</div></button>; })}</div>
        {!isMiniappHost && <Button variant="outline" className="mt-5 w-full" onClick={() => { setShowCommunityPicker(false); setCommunityStep("idle"); setCommunityName(""); setCommunityDescription(""); setGroupAddress(""); setGroupName(""); setGroupDescription(""); setCommunityError(""); setCommunityModal("create"); }}><Plus className="h-4 w-4" />Activate or create community</Button>}
      </div></div>}

      {showJoin && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="w-full max-w-lg rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
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

      {communityModal && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">Community registry</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{communityModal === "create" ? "Add a community" : `Manage ${activeCommunity?.name ?? "community"}`}</h2></div><button type="button" onClick={() => setCommunityModal(null)} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close community panel"><X className="h-4 w-4" /></button></div>
        {communityModal === "create" ? communityStep === "created" ? <div className="py-8 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Community created</h3><p className="mt-2 text-sm leading-6 text-ink/60">Your Circles Organization is registered and selected. Members can now request to join it.</p><div className="mt-5 rounded-2xl border border-moss/20 bg-moss/5 p-3 text-left"><p className="text-xs font-bold uppercase tracking-wider text-moss">Organization address</p><p className="mt-2 break-all font-mono text-xs text-ink/70">{organizationAddress}</p></div><Button className="mt-6" onClick={() => { setCommunityStep("idle"); setCommunityModal("manage"); }}>Manage members</Button></div> : <>
          <div className="mt-5 rounded-2xl border border-moss/20 bg-moss/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-moss">Recommended path</p>
            <h3 className="mt-2 font-display text-xl font-bold tracking-tight">Activate an existing Circles Group</h3>
            <p className="mt-2 text-xs leading-5 text-ink/55">Use this when a real Circles Group already exists. Commons lists the Group, attaches services and projects to it, and uses the Group address as the project treasury for this MVP.</p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Group address<input value={groupAddress} onChange={(event) => setGroupAddress(event.target.value)} placeholder="0x existing Circles Group address" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 font-mono text-xs font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Group name<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="e.g. Montreuil Repair Group" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="What is this Group useful for locally?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
            <Button className="mt-4 w-full" onClick={activateGroup} disabled={!groupAddress.trim() || !groupName.trim()}><Plus className="h-4 w-4" />Activate Group on Commons</Button>
            <p className="mt-3 text-[11px] leading-5 text-ink/45">Hackathon MVP: only activate Groups you control or represent. On-chain owner verification is the next admin upgrade.</p>
          </div>
          <div className="my-5 flex items-center gap-3"><span className="h-px flex-1 bg-ink/10" /><span className="text-[10px] font-bold uppercase tracking-wider text-ink/35">or</span><span className="h-px flex-1 bg-ink/10" /></div>
          <p className="text-sm leading-6 text-ink/60">Create a new Circles Organization on Gnosis Chain. This is the advanced treasury flow and requires Rabby or MetaMask with xDAI for gas.</p>
          <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Signing wallet</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{connectedWallet || "Connect Rabby or MetaMask on Gnosis Chain"}</p></div><Wallet className="h-5 w-5 shrink-0 text-indigo" /></div><Button variant="outline" className="mt-3 w-full" onClick={connectWallet} disabled={communityStep === "connecting"}>{communityStep === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}{connectedWallet ? "Reconnect wallet" : "Connect wallet"}</Button></div>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Community name<input value={communityName} onChange={(event) => setCommunityName(event.target.value)} placeholder="e.g. Commons Lab" className="mt-2 w-full rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
          <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={communityDescription} onChange={(event) => setCommunityDescription(event.target.value)} placeholder="What will your community fund together?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-white px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label>
          {communityError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{communityError}</p>}
          <Button className="mt-5 w-full" onClick={createCommunity} disabled={!communityName.trim() || communityStep === "registering"}>{communityStep === "registering" && <Loader2 className="h-4 w-4 animate-spin" />}{communityStep === "registering" ? "Confirm in your wallet" : "Register Organization"}</Button>
          <p className="mt-3 text-center text-[11px] leading-5 text-ink/45">This sends an on-chain transaction. Your wallet needs a small amount of xDAI for gas.</p>
        </> : isActiveCommunityGroup ? <>
          <div className="mt-5 rounded-2xl border border-moss/20 bg-moss/5 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-moss">Activated Circles Group</p>
            <h3 className="mt-2 font-display text-xl font-bold tracking-tight">{activeCommunity?.name}</h3>
            <p className="mt-2 text-sm leading-6 text-ink/60">This community is an existing Circles Group listed on Commons. Members can publish services and projects can be presented under this Group.</p>
            <div className="mt-4 rounded-xl bg-white/75 p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-ink/45">Group address</p>
              <p className="mt-2 break-all font-mono text-xs text-ink/65">{activeCommunity?.address}</p>
            </div>
            <p className="mt-3 rounded-xl bg-sand/70 p-3 text-xs leading-5 text-ink/55">Owner-gated Group administration is intentionally not enabled yet. The next step is reading the Group owner/controller from Circles and allowing only that address to create projects or approve members.</p>
          </div>
        </> : <>
          <p className="mt-4 text-sm leading-6 text-ink/60">Only the wallet controlling this Organization can approve members. Connect the admin wallet to open the approval queue.</p>
          <div className="mt-5 rounded-2xl border border-ink/10 bg-white/70 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-ink/45">Organization admin</p><p className="mt-1 break-all font-mono text-xs text-ink/65">{connectedWallet || "Connect the Organization wallet"}</p></div><Wallet className="h-5 w-5 shrink-0 text-indigo" /></div><Button variant="outline" className="mt-3 w-full" onClick={connectWallet} disabled={communityStep === "connecting"}>{communityStep === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}{connectedWallet ? "Reconnect wallet" : "Connect admin wallet"}</Button></div>
          {connectedWallet && !isConnectedAdmin && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">This wallet does not control the selected Organization. Member approvals remain locked.</p>}
          {isConnectedAdmin && <><div className="mt-4 rounded-2xl border border-ink/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/50">Approve community members</p><p className="mt-2 text-xs leading-5 text-ink/55">Approved members can contribute personal CRC to this treasury. Approval is recorded on-chain.</p>{membershipRequests.length > 0 && <div className="mt-3 space-y-2">{membershipRequests.map((request) => { const approved = approvedAddresses.includes(request.address.toLowerCase()); return <div key={request.address} className="rounded-xl border border-moss/15 bg-moss/5 p-3"><p className="break-all font-mono text-xs text-ink/65">{request.address}</p><p className="mt-1 text-[10px] text-ink/40">Requested {new Date(request.requestedAt).toLocaleDateString()}</p><Button size="sm" variant={approved ? "outline" : "default"} className="mt-2 w-full" onClick={() => addMemberTrust(request.address)} disabled={approved || trustState === "adding"}>{trustState === "adding" && <Loader2 className="h-4 w-4 animate-spin" />}{approved ? "Already approved" : "Approve member"}</Button></div>; })}</div>}<p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink/40">Add an address directly</p><input value={memberAddress} onChange={(event) => setMemberAddress(event.target.value)} placeholder="0x member Circles address" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 font-mono text-xs outline-none transition focus:border-indigo/45" /><Button variant="outline" className="mt-3 w-full" onClick={() => addMemberTrust()} disabled={!memberAddress.trim() || trustState === "adding" || approvedAddresses.includes(memberAddress.trim().toLowerCase())}>{trustState === "adding" && <Loader2 className="h-4 w-4 animate-spin" />}{approvedAddresses.includes(memberAddress.trim().toLowerCase()) ? "Already approved" : trustState === "adding" ? "Confirm in your wallet" : "Approve address"}</Button></div>
          <div className="mt-4 rounded-2xl border border-ink/10 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wider text-ink/50">Create a community project</p><p className="mt-2 text-xs leading-5 text-ink/55">Projects are funding proposals inside this community. Contributions go to the community treasury.</p><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Project title<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="Community garden, tool library..." className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="mt-4 block text-xs font-bold uppercase tracking-wider text-ink/50">Description<textarea value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="What will the community fund together?" rows={3} className="mt-2 w-full resize-none rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Location<input value={projectLocation} onChange={(event) => setProjectLocation(event.target.value)} placeholder="Where it happens" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label><label className="block text-xs font-bold uppercase tracking-wider text-ink/50">Goal in CRC<input value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)} placeholder="50" inputMode="decimal" className="mt-2 w-full rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-sm font-normal normal-case tracking-normal outline-none transition focus:border-indigo/45" /></label></div><p className="mt-4 text-[11px] font-bold uppercase tracking-wider text-ink/40">Milestones</p><div className="mt-2 grid gap-2 sm:grid-cols-3"><input value={projectMilestoneOne} onChange={(event) => setProjectMilestoneOne(event.target.value)} placeholder="First step" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneTwo} onChange={(event) => setProjectMilestoneTwo(event.target.value)} placeholder="Halfway" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /><input value={projectMilestoneThree} onChange={(event) => setProjectMilestoneThree(event.target.value)} placeholder="Completed" className="rounded-xl border border-ink/10 bg-cream px-3 py-2.5 text-xs outline-none transition focus:border-indigo/45" /></div>{projectError && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">{projectError}</p>}<Button className="mt-4 w-full" onClick={submitProject}><Plus className="h-4 w-4" />Create project</Button></div></>}
        </>}
      </div></div>}

      {checkout && <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-cream p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo">{checkout.kind === "service" ? "Book a service" : "Fund this project"}</p><h2 className="mt-2 font-display text-2xl font-bold tracking-tight">{checkout.item.title}</h2></div><button type="button" onClick={closeCheckout} className="rounded-full border border-ink/10 bg-white p-2 text-ink/55" aria-label="Close checkout"><X className="h-4 w-4" /></button></div>
        {status === "confirmed" ? <div className="py-10 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-moss/10 text-moss"><CheckCircle2 className="h-8 w-8" /></div><h3 className="mt-5 font-display text-2xl font-bold">Payment confirmed</h3><p className="mt-2 text-sm leading-6 text-ink/60">{checkout.amount} CRC are now circulating through your community.</p><Button className="mt-6" onClick={closeCheckout}>Back to Commons</Button></div> : <>
          <div className="mt-5 flex items-center justify-between rounded-2xl bg-white p-4"><span className="text-sm font-medium text-ink/55">Amount to pay</span><span className="font-display text-2xl font-bold">{checkout.amount} CRC</span></div>
          <div className="mt-3 rounded-2xl border border-ink/10 bg-sand/60 p-3 text-xs text-ink/55"><p className="font-semibold text-ink/70">Unique payment reference</p><p className="mt-1 font-mono">{reference.slice(0, 27)}...</p></div>
          {!checkoutRecipientAddress && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">No payment recipient is configured for this checkout.</p>}
          {checkout.kind === "service" && <div className="mt-3 rounded-2xl border border-ink/10 bg-white/70 p-3 text-xs text-ink/55"><p className="font-semibold text-ink/70">Recipient</p><p className="mt-1">This CRC payment goes directly to {checkout.item.provider}, not to the community treasury.</p><p className="mt-1 break-all font-mono">{checkout.item.providerAddress}</p></div>}
          {isMiniappHost ? <div className="mt-4"><Button className="w-full" disabled={!hostWalletAddress || !checkoutRecipientAddress || embeddedPaymentState === "submitting"} onClick={payInsideGnosisApp}>{embeddedPaymentState === "submitting" && <Loader2 className="h-4 w-4 animate-spin" />}{embeddedPaymentState === "submitting" ? "Approve in Gnosis App" : "Pay with Gnosis App"}</Button>{embeddedPaymentState === "submitted" && <p className="mt-3 rounded-xl bg-moss/10 p-3 text-xs leading-5 text-moss">Transaction submitted. Waiting for on-chain confirmation.</p>}{embeddedPaymentState === "error" && <p className="mt-3 rounded-xl bg-coral/10 p-3 text-xs leading-5 text-coral">The transaction was not submitted. You can try again.</p>}</div> : <><div className="mt-4 grid gap-2 sm:grid-cols-2"><Button asChild={Boolean(paymentLink)} disabled={!paymentLink} onClick={() => setWatching(true)}>{paymentLink ? <a href={paymentLink} target="_blank" rel="noreferrer">Open Gnosis App <ArrowUpRight className="h-4 w-4" /></a> : <span>Open Gnosis App <ArrowUpRight className="h-4 w-4" /></span>}</Button><Button variant="outline" disabled={!paymentLink} onClick={() => setShowQr((current) => !current)}><QrCode className="h-4 w-4" />{showQr ? "Hide QR code" : "Show QR code"}</Button><Button variant="secondary" disabled={!paymentLink} className="sm:col-span-2" onClick={copyLink}><Clipboard className="h-4 w-4" />{copyState === "copied" ? "Link copied" : copyState === "error" ? "Copy failed" : "Copy payment link"}</Button></div>
          {showQr && <div className="mt-4 rounded-2xl bg-white p-4 text-center">{qrCode ? <Image src={qrCode} alt="Payment QR code" width={240} height={240} className="mx-auto h-56 w-56" unoptimized /> : <p className="py-20 text-xs text-ink/45">Generating QR code...</p>}<p className="mt-2 text-xs text-ink/50">Scan with your phone to continue in Gnosis App.</p></div>}</>}
          <div className="mt-4 rounded-2xl border border-ink/10 bg-white/70 p-4"><PaymentStatus status={status} payment={payment} error={error} /><Button variant={watching ? "outline" : "default"} disabled={!paymentLink} className="mt-4 w-full" onClick={() => setWatching((current) => !current)}>{watching ? "Stop monitoring" : "I paid, check payment"}</Button></div>
        </>}
      </div></div>}
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="rounded-2xl bg-sand/60 p-3"><p className="font-display text-xl font-bold">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-ink/45">{label}</p></div>;
}
function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-coral">{eyebrow}</p><h2 className="mt-3 font-display text-3xl font-bold tracking-[-0.04em] sm:text-4xl">{title}</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-ink/60">{description}</p></div>;
}
