import type { NoticeTone, ProfilesSnapshot } from '../types';

export interface PageProps {
  notify: (tone: NoticeTone, message: string) => void;
  profile: string;
  profiles: ProfilesSnapshot | null;
  refreshProfiles: (preferredProfile?: string) => Promise<void>;
}
