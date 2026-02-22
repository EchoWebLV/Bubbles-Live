"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import {
  getRealm,
  getGovernance,
  getAllGovernances,
  getAllProposals,
  getTokenOwnerRecordsByOwner,
  withCreateProposal,
  withSignOffProposal,
  withCastVote,
  withDepositGoverningTokens,
  withWithdrawGoverningTokens,
  Vote,
  VoteType,
  VoteKind,
  YesNoVote,
  ProposalState,
  VoteChoice,
} from "@solana/spl-governance";

const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey("GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw");

export interface GovernanceStatus {
  initialized: boolean;
  realm: {
    name: string;
    address: string;
    communityMint: string;
  } | null;
  proposals: GovernanceProposal[];
  stats: {
    totalProposals: number;
    activeProposals: number;
    passedProposals: number;
    appliedOverrides: number;
  };
  configOverrides: Record<string, Record<string, number>>;
  lastPollTime: number;
  configurableKeys: Record<string, string[]>;
}

export interface GovernanceProposal {
  pubkey: string;
  name: string;
  descriptionLink: string;
  state: number;
  stateLabel: string;
  yesVotes: string;
  noVotes: string;
  draftAt: number;
  votingAt: number;
  votingCompletedAt: number;
  metadata: {
    type: string;
    key: string;
    value: number;
    description?: string;
  } | null;
}

export interface VoterInfo {
  hasRecord: boolean;
  deposited: string;
  pubkey?: string;
  unrelinquishedVotes?: number;
}

export function useGovernance() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [status, setStatus] = useState<GovernanceStatus | null>(null);
  const [voterInfo, setVoterInfo] = useState<VoterInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const walletAddress = publicKey?.toBase58() || null;

  // Fetch governance status from server
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/governance");
      if (!res.ok) throw new Error("Failed to fetch governance");
      const data: GovernanceStatus = await res.json();
      setStatus(data);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch voter info for connected wallet
  const fetchVoterInfo = useCallback(async () => {
    if (!walletAddress) {
      setVoterInfo(null);
      return;
    }
    try {
      const res = await fetch(`/api/governance/voter?wallet=${walletAddress}`);
      if (!res.ok) return;
      const data: VoterInfo = await res.json();
      setVoterInfo(data);
    } catch {
      // non-critical
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetchVoterInfo();
    const interval = setInterval(fetchVoterInfo, 30000);
    return () => clearInterval(interval);
  }, [fetchVoterInfo]);

  // Deposit tokens to gain voting power
  const depositTokens = useCallback(async (amount: number) => {
    if (!publicKey || !status?.realm || !sendTransaction) return false;
    setSubmitting(true);
    try {
      const realmPk = new PublicKey(status.realm.address);
      const communityMint = new PublicKey(status.realm.communityMint);

      const instructions: TransactionInstruction[] = [];
      await withDepositGoverningTokens(
        instructions,
        SPL_GOVERNANCE_PROGRAM_ID,
        2, // program version
        realmPk,
        publicKey, // source token account (ATA for community mint)
        communityMint,
        publicKey, // token owner
        publicKey, // payer
        publicKey, // token authority
        new BN(amount),
      );

      const tx = new Transaction().add(...instructions);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      await fetchVoterInfo();
      return true;
    } catch (err) {
      console.error("Deposit tokens error:", err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, status, sendTransaction, connection, fetchVoterInfo]);

  // Withdraw tokens
  const withdrawTokens = useCallback(async () => {
    if (!publicKey || !status?.realm || !sendTransaction) return false;
    setSubmitting(true);
    try {
      const realmPk = new PublicKey(status.realm.address);
      const communityMint = new PublicKey(status.realm.communityMint);

      const instructions: TransactionInstruction[] = [];
      await withWithdrawGoverningTokens(
        instructions,
        SPL_GOVERNANCE_PROGRAM_ID,
        2,
        realmPk,
        publicKey, // destination token account
        communityMint,
        publicKey, // token owner
      );

      const tx = new Transaction().add(...instructions);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      await fetchVoterInfo();
      return true;
    } catch (err) {
      console.error("Withdraw tokens error:", err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, status, sendTransaction, connection, fetchVoterInfo]);

  // Create a proposal
  const createProposal = useCallback(async (
    name: string,
    metadata: { type: string; key: string; value: number; description?: string },
  ) => {
    if (!publicKey || !status?.realm || !sendTransaction) return false;
    setSubmitting(true);
    try {
      const realmPk = new PublicKey(status.realm.address);
      const communityMint = new PublicKey(status.realm.communityMint);

      const governances = await getAllGovernances(
        connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        realmPk,
      );

      if (governances.length === 0) {
        throw new Error("No governance found for this Realm");
      }

      const governancePk = governances[0].pubkey;

      const records = await getTokenOwnerRecordsByOwner(
        connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        publicKey,
      );
      const realmRecord = records.find(
        r => r.account.realm.toBase58() === realmPk.toBase58()
      );
      if (!realmRecord) {
        throw new Error("You must deposit tokens before creating proposals");
      }

      const instructions: TransactionInstruction[] = [];
      const proposalPk = await withCreateProposal(
        instructions,
        SPL_GOVERNANCE_PROGRAM_ID,
        2,
        realmPk,
        governancePk,
        realmRecord.pubkey,
        name,
        JSON.stringify(metadata),
        communityMint,
        publicKey,
        undefined, // proposalIndex
        VoteType.SINGLE_CHOICE,
        ["Approve"],
        true, // useDenyOption
        publicKey,
      );

      await withSignOffProposal(
        instructions,
        SPL_GOVERNANCE_PROGRAM_ID,
        2,
        realmPk,
        governancePk,
        proposalPk,
        publicKey,
        undefined,
        realmRecord.pubkey,
      );

      const tx = new Transaction().add(...instructions);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTimeout(fetchStatus, 3000);
      return true;
    } catch (err) {
      console.error("Create proposal error:", err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, status, sendTransaction, connection, fetchStatus]);

  // Cast a vote
  const castVote = useCallback(async (proposalPk: string, approve: boolean) => {
    if (!publicKey || !status?.realm || !sendTransaction) return false;
    setSubmitting(true);
    try {
      const realmPk = new PublicKey(status.realm.address);
      const communityMint = new PublicKey(status.realm.communityMint);
      const proposal = new PublicKey(proposalPk);

      const governances = await getAllGovernances(
        connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        realmPk,
      );
      if (governances.length === 0) throw new Error("No governance found");
      const governancePk = governances[0].pubkey;

      const records = await getTokenOwnerRecordsByOwner(
        connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        publicKey,
      );
      const realmRecord = records.find(
        r => r.account.realm.toBase58() === realmPk.toBase58()
      );
      if (!realmRecord) {
        throw new Error("You must deposit tokens before voting");
      }

      const vote = approve
        ? new Vote({
            voteType: VoteKind.Approve,
            approveChoices: [new VoteChoice({ rank: 0, weightPercentage: 100 })],
            deny: undefined,
            veto: undefined,
          })
        : new Vote({
            voteType: VoteKind.Deny,
            approveChoices: undefined,
            deny: true,
            veto: undefined,
          });

      const instructions: TransactionInstruction[] = [];
      await withCastVote(
        instructions,
        SPL_GOVERNANCE_PROGRAM_ID,
        2,
        realmPk,
        governancePk,
        proposal,
        realmRecord.pubkey, // proposal owner record (not used for voting, but required)
        realmRecord.pubkey, // voter token owner record
        publicKey,
        communityMint,
        vote,
        publicKey,
      );

      const tx = new Transaction().add(...instructions);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTimeout(fetchStatus, 3000);
      return true;
    } catch (err) {
      console.error("Cast vote error:", err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [publicKey, status, sendTransaction, connection, fetchStatus]);

  const activeProposals = useMemo(
    () => status?.proposals.filter(p => p.state === ProposalState.Voting) || [],
    [status],
  );

  const passedProposals = useMemo(
    () => status?.proposals.filter(
      p => p.state === ProposalState.Completed || p.state === ProposalState.Executing || p.state === ProposalState.Succeeded,
    ) || [],
    [status],
  );

  return {
    status,
    voterInfo,
    loading,
    error,
    submitting,
    activeProposals,
    passedProposals,
    depositTokens,
    withdrawTokens,
    createProposal,
    castVote,
    refresh: fetchStatus,
  };
}
