'use client';
import { useState, useEffect } from 'react';
import { AGENT_BACKEND_URL } from '@/lib/contracts';

interface License { skillIndex: number; licenseId: string; purchasedAt: number; expiresAt: number; }

export function useUserLicenses(userAddress: string | undefined) {
  const [licenses, setLicenses] = useState<License[]>([]);

  useEffect(() => {
    if (!userAddress) return;
    fetch(`${AGENT_BACKEND_URL}/skill/user/${userAddress}/licenses`)
      .then(r => r.json())
      .then(d => setLicenses(d.licenses ?? []))
      .catch(() => {});
  }, [userAddress]);

  const refetch = () => {
    if (!userAddress) return;
    fetch(`${AGENT_BACKEND_URL}/skill/user/${userAddress}/licenses`)
      .then(r => r.json())
      .then(d => setLicenses(d.licenses ?? []))
      .catch(() => {});
  };

  return { licenses, hasSkill: (idx: number) => licenses.some(l => l.skillIndex === idx), refetch };
}
