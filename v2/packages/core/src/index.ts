export type { Book, UserBook, ReadingStatus } from "@tsundoku/types";

export interface NativeServices {
  openExternalLink(url: string): Promise<void>;
  share?(text: string): Promise<void>;
}
