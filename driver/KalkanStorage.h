#ifndef KALKAN_STORAGE_H
#define KALKAN_STORAGE_H
/* Windows volume characteristics are evidence, not USB bus identification.
   Portable can also mean FireWire; removable media can be a card reader. */
#define KALKAN_STORAGE_UNKNOWN 0u
#define KALKAN_STORAGE_LOCAL_DISK 1u
#define KALKAN_STORAGE_PORTABLE 2u
#define KALKAN_STORAGE_REMOVABLE_MEDIA 3u
#define KALKAN_STORAGE_REMOTE 4u
static __inline unsigned long KalkanClassifyVolume(long status, unsigned long returned,
    unsigned long deviceType, unsigned long characteristics)
{
    if (status != 0 || returned != 8) return KALKAN_STORAGE_UNKNOWN;
    if (characteristics & (0x10u | 0x80000u)) return KALKAN_STORAGE_REMOTE;
    if (deviceType != 7u && deviceType != 8u) return KALKAN_STORAGE_UNKNOWN;
    if (characteristics & 0x40000u) return KALKAN_STORAGE_PORTABLE;
    if (characteristics & 1u) return KALKAN_STORAGE_REMOVABLE_MEDIA;
    return KALKAN_STORAGE_LOCAL_DISK;
}
#endif
