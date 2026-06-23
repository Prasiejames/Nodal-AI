/**
 * backend/rpc_client.ts
 * Thin wrapper around Horizon + Soroban RPC with retry logic.
 * All network calls route through here — centralised observability point.
 */

import {
  Horizon,
  rpc,
  Transaction,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { config } from "./config";

// ─── Exponential back-off retry ─────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = config.MAX_RETRIES,
  delayMs = config.RETRY_DELAY_MS
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`  Attempt ${attempt}/${retries} failed:`, (err as Error).message);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, delayMs * attempt)); // exponential back-off
      }
    }
  }
  throw lastErr;
}

// ─── Horizon client ──────────────────────────────────────────────────────────

export const horizonServer = new Horizon.Server(config.HORIZON_URL, {
  allowHttp: config.STELLAR_NETWORK !== "mainnet",
});

export async function loadAccount(publicKey: string) {
  return withRetry(() => horizonServer.loadAccount(publicKey));
}

export async function submitTransaction(tx: Transaction | FeeBumpTransaction) {
  return withRetry(() => horizonServer.submitTransaction(tx));
}

// ─── Soroban RPC client ───────────────────────────────────────────────────────

export const sorobanServer = new rpc.Server(config.SOROBAN_RPC_URL, {
  allowHttp: config.STELLAR_NETWORK !== "mainnet",
});

/**
 * Simulate a Soroban transaction BEFORE broadcasting.
 * Returns the simulation result — callers MUST check for errors.
 */
export async function simulateSorobanTx(tx: Transaction) {
  return withRetry(() => sorobanServer.simulateTransaction(tx));
}

/**
 * Prepare (simulate + assemble) a Soroban transaction.
 * Throws if simulation indicates failure — safe guard before broadcast.
 */
export async function prepareSorobanTx(tx: Transaction): Promise<Transaction> {
  const simResult = await simulateSorobanTx(tx);

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Soroban simulation failed: ${(simResult as any).error}`);
  }

  return rpc.assembleTransaction(tx, simResult).build();
}
