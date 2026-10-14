export interface ISizeCalculationResult {
  width: number;
  height: number;
  type?: string;
  orientation?: number;
}

export declare function imageSize(input: Uint8Array | string): ISizeCalculationResult;
export default imageSize;