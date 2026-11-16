#ifndef KALKAN_IO_GATE_H
#define KALKAN_IO_GATE_H
/* All calls require the owning instance's spin lock. Never wait under it. */
typedef struct _KALKAN_IO_GATE {
    unsigned long Readers, Mutations;
    int WritableMappingSeen, Invalid;
    unsigned __int64 Generation;
} KALKAN_IO_GATE;
static __inline int KalkanBeginRead(KALKAN_IO_GATE *gate)
{
    if (!gate->Generation || gate->Invalid || gate->WritableMappingSeen || gate->Mutations || gate->Readers == ~0u) return 0;
    ++gate->Readers; return 1;
}
static __inline void KalkanEndRead(KALKAN_IO_GATE *gate)
{
    if (!gate->Readers) gate->Invalid = 1; else --gate->Readers;
}
static __inline int KalkanBeginMutation(KALKAN_IO_GATE *gate, int mapped)
{
    if (gate->Readers || gate->Invalid || gate->Mutations == ~0u) return 0;
    if (!gate->Generation || gate->Generation == ~(unsigned __int64)0) { gate->Invalid = 1; return 0; }
    ++gate->Generation;
    ++gate->Mutations;
    if (mapped) gate->WritableMappingSeen = 1;
    return 1;
}
static __inline void KalkanEndMutation(KALKAN_IO_GATE *gate)
{
    if (!gate->Mutations) gate->Invalid = 1; else --gate->Mutations;
    if (gate->Generation == ~(unsigned __int64)0) gate->Invalid = 1; else ++gate->Generation;
}
static __inline unsigned __int64 KalkanReadGeneration(const KALKAN_IO_GATE *gate)
{
    return gate->Readers && !gate->Mutations && !gate->Invalid && !gate->WritableMappingSeen ? gate->Generation : 0;
}
#endif
