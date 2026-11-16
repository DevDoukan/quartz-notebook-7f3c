#ifndef KALKAN_CREATE_H
#define KALKAN_CREATE_H
/* Narrow allow-list: only opening an existing object for read/execute and
   metadata query is nonmutating. Unknown access rights stay conservative. */
static __inline int KalkanCreateMayMutate(unsigned long options, unsigned long access,
    unsigned long eaLength, unsigned __int64 allocationSize)
{
    const unsigned long readOnly = 0x00000001u | 0x00000008u | 0x00000020u |
        0x00000080u | 0x00020000u | 0x00100000u | 0x80000000u | 0x20000000u;
    return (options >> 24) != 1u || (options & 0x1000u) != 0 ||
        (access & ~readOnly) != 0 || eaLength != 0 || allocationSize != 0;
}
#endif
