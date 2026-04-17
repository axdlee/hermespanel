import { describe, it, expect, beforeEach } from 'vitest';
import { mockInvoke } from '../test/setup';
import { api } from '../lib/api';

describe('API', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('getProfilesSnapshot', () => {
    it('calls invoke with correct command', async () => {
      const mockProfiles = {
        activeProfile: 'default',
        profiles: [{ name: 'default', homePath: '~/.hermes', isDefault: true, isActive: true }],
      };
      mockInvoke.mockResolvedValueOnce(mockProfiles);

      const result = await api.getProfilesSnapshot();

      expect(mockInvoke).toHaveBeenCalledWith('get_profiles_snapshot');
      expect(result).toEqual(mockProfiles);
    });

    it('throws error when invoke fails', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('API error'));

      await expect(api.getProfilesSnapshot()).rejects.toThrow('API error');
    });
  });

  describe('setActiveProfile', () => {
    it('calls invoke with profileName', async () => {
      const mockProfiles = {
        activeProfile: 'test',
        profiles: [{ name: 'test', homePath: '~/.hermes-test', isDefault: false, isActive: true }],
      };
      mockInvoke.mockResolvedValueOnce(mockProfiles);

      const result = await api.setActiveProfile('test');

      expect(mockInvoke).toHaveBeenCalledWith('set_active_profile', { profileName: 'test' });
      expect(result).toEqual(mockProfiles);
    });
  });

  describe('getDashboardSnapshot', () => {
    it('calls invoke with profile parameter', async () => {
      const mockDashboard = {
        profileName: 'default',
        hermesHome: '~/.hermes',
        hermesBinary: 'hermes',
        binaryFound: true,
        versionOutput: 'v1.0.0',
        config: {},
        counts: { sessions: 0, skills: 0, logFiles: 0, cronJobs: 0, configuredPlatforms: 0 },
        recentSessions: [],
        memoryFiles: [],
        warnings: [],
      };
      mockInvoke.mockResolvedValueOnce(mockDashboard);

      const result = await api.getDashboardSnapshot('default');

      expect(mockInvoke).toHaveBeenCalledWith('get_dashboard_snapshot', { profile: 'default' });
      expect(result).toEqual(mockDashboard);
    });

    it('calls invoke without profile when not specified', async () => {
      mockInvoke.mockResolvedValueOnce({});

      await api.getDashboardSnapshot();

      expect(mockInvoke).toHaveBeenCalledWith('get_dashboard_snapshot', { profile: null });
    });
  });
});
