import { useQuery } from '@tanstack/react-query';
import { VehicleSizeCategory } from '@autowash/shared';
import { api } from './api';
import { CatalogCategory, PublicSettings, Vehicle, Address } from './types';

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api<PublicSettings>('/settings/public'),
    staleTime: 1000 * 60 * 5,
  });
}

export function useCatalog(sizeCategory: VehicleSizeCategory) {
  return useQuery({
    queryKey: ['services', sizeCategory],
    queryFn: () => api<CatalogCategory[]>(`/services?sizeCategory=${sizeCategory}`),
  });
}

export function useMyVehicles(enabled: boolean) {
  return useQuery({
    queryKey: ['vehicles', 'mine'],
    queryFn: () => api<Vehicle[]>('/vehicles/my'),
    enabled,
  });
}

export function useMyAddresses(enabled: boolean) {
  return useQuery({
    queryKey: ['addresses', 'mine'],
    queryFn: () => api<Address[]>('/addresses/my'),
    enabled,
  });
}
