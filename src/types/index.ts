export type Vector = number[];
export type Matrix = number[][];
export type Label = string | number;

export interface ModelConfig {
    lr?: number;
    epochs?: number;
    k?: number;
}
