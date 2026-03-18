import axios, { AxiosInstance } from 'axios';
import {
  L2OrderBook,
  HyperliquidMetaResponse,
  HyperliquidMetaAndAssetCtxsResponse
} from '../types/index.js';

export class HyperliquidAPI {
  private client: AxiosInstance;
  private hip3Dexes: string[];

  constructor(baseUrl: string, hip3Dexes: string[] = []) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    this.hip3Dexes = hip3Dexes;
  }

  /**
   * Fetch L2 order book for a specific coin
   */
  async getL2OrderBook(coin: string): Promise<L2OrderBook> {
    try {
      const response = await this.client.post('/info', {
        type: 'l2Book',
        coin,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch L2 order book for ${coin}: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Fetch all available assets/pairs
   */
  async getMeta(): Promise<HyperliquidMetaResponse> {
    try {
      const response = await this.client.post('/info', {
        type: 'meta',
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch meta data: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetch meta data and asset contexts (including 24h volume)
   */
  async getMetaAndAssetCtxs(): Promise<HyperliquidMetaAndAssetCtxsResponse> {
    try {
      const response = await this.client.post('/info', {
        type: 'metaAndAssetCtxs',
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to fetch meta and asset contexts: ${error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Get 24h volume for a specific coin
   */
  async get24hVolume(coin: string): Promise<number> {
    try {
      const data = await this.getMetaAndAssetCtxs();
      const assetCtx = data.assetCtxs.find(ctx => ctx.coin === coin);

      if (!assetCtx) {
        throw new Error(`Asset context not found for ${coin}`);
      }

      return parseFloat(assetCtx.dayNtlVlm);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get 24h volume for ${coin}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Fetch meta data for a HIP-3 builder dex (tokenized stocks, etc.)
   */
  async getHip3Meta(dex: string): Promise<HyperliquidMetaResponse> {
    try {
      const response = await this.client.post('/info', {
        type: 'meta',
        dex,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch HIP-3 meta for dex "${dex}": ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get all available perpetual symbols (including HIP-3 markets)
   */
  async getAllPerpetuals(): Promise<string[]> {
    try {
      // Fetch standard perps
      const meta = await this.getMeta();
      const standardPerps = meta.universe.map(asset => asset.name);

      // Fetch HIP-3 markets from configured dexes
      const hip3Pairs: string[] = [];
      for (const dex of this.hip3Dexes) {
        try {
          const hip3Meta = await this.getHip3Meta(dex);
          const dexPairs = hip3Meta.universe.map(asset => asset.name);
          hip3Pairs.push(...dexPairs);
          console.log(`   HIP-3 dex "${dex}": found ${dexPairs.length} pairs`);
        } catch (error) {
          console.warn(`   ⚠ Failed to fetch HIP-3 dex "${dex}":`, error instanceof Error ? error.message : error);
        }
      }

      const allPairs = [...standardPerps, ...hip3Pairs];
      if (hip3Pairs.length > 0) {
        console.log(`   Total: ${standardPerps.length} standard + ${hip3Pairs.length} HIP-3 = ${allPairs.length} pairs`);
      }

      return allPairs;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to get all perpetuals: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      await this.getMeta();
      return true;
    } catch {
      return false;
    }
  }
}
