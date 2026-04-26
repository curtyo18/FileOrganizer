// Mock data for FileOrganizer
window.FOData = (() => {
  const drives = [
    { id: 'C', label: 'System', letter: 'C:', kind: 'local-ssd', total: 1024, used: 612, roles: ['active-projects'], status: 'connected', lastScan: '2h ago' },
    { id: 'D', label: 'Workhorse', letter: 'D:', kind: 'local-ssd', total: 2048, used: 1421, roles: ['active-documents', 'active-projects'], status: 'connected', lastScan: '12m ago' },
    { id: 'E', label: 'Archive HDD', letter: 'E:', kind: 'local-hdd', total: 4096, used: 3204, roles: ['media-archive', 'document-archive'], status: 'connected', lastScan: '3d ago' },
    { id: 'N', label: 'Pylon NAS', letter: 'Z:', kind: 'network', total: 12288, used: 7421, roles: ['media-archive', 'backup', 'document-archive'], status: 'scanning', lastScan: 'now', scanProgress: 0.42 },
    { id: 'X', label: 'LaCie Travel', letter: 'F:', kind: 'external', total: 2048, used: 1882, roles: ['backup'], status: 'disconnected', lastScan: '14d ago' },
  ];

  const driveMap = Object.fromEntries(drives.map(d => [d.id, d]));

  const dupGroups = [
    {
      id: 'g1', hash: '9f2c4b…a7d1', size: 8.4, count: 4, reclaim: 25.2, category: 'image',
      copies: [
        { drive: 'E', path: '\\Photos\\2019\\06\\IMG_4421.jpg', mtime: '2019-06-14', score: 92, keeper: true, reasons: ['role match: media-archive', 'organized path', 'depth 3'] },
        { drive: 'D', path: '\\old-imports\\camera\\IMG_4421.jpg', mtime: '2024-08-02', score: 41 },
        { drive: 'C', path: '\\Users\\curt\\Desktop\\IMG_4421.jpg', mtime: '2025-11-18', score: 18 },
        { drive: 'N', path: '\\backup-2023\\dump\\IMG_4421.jpg', mtime: '2023-04-01', score: 28 },
      ],
    },
    {
      id: 'g2', hash: '3a91e8…0c4f', size: 1240, count: 3, reclaim: 2480, category: 'video',
      copies: [
        { drive: 'N', path: '\\Videos\\2022\\11\\trip-amalfi.mp4', mtime: '2022-11-22', score: 88, keeper: true, reasons: ['role match', 'organized path'] },
        { drive: 'E', path: '\\import\\trip-amalfi.mp4', mtime: '2022-12-01', score: 52 },
        { drive: 'D', path: '\\downloads\\trip-amalfi (1).mp4', mtime: '2023-01-14', score: 24 },
      ],
    },
    {
      id: 'g3', hash: 'cc12f4…8e90', size: 0.4, count: 8, reclaim: 2.8, category: 'document',
      copies: Array.from({length: 8}, (_, i) => ({
        drive: ['D','D','E','N','C','C','D','E'][i],
        path: ['\\Documents\\taxes-2021.pdf','\\backup\\taxes-2021.pdf','\\Documents\\_archive\\2021\\taxes-2021.pdf','\\Documents\\taxes\\2021\\taxes-2021.pdf','\\Users\\curt\\Downloads\\taxes-2021.pdf','\\Users\\curt\\Desktop\\taxes-2021.pdf','\\old\\taxes-2021.pdf','\\import\\taxes-2021.pdf'][i],
        mtime: '2021-04-15',
        score: i === 3 ? 81 : 30 - i,
        keeper: i === 3,
      })),
    },
    {
      id: 'g4', hash: '7b8d2e…3f01', size: 14.2, count: 2, reclaim: 14.2, category: 'image',
      copies: [
        { drive: 'E', path: '\\Photos\\2024\\03\\sunset-deck.jpg', mtime: '2024-03-09', score: 90, keeper: true, reasons: ['role match', 'organized path', 'older mtime'] },
        { drive: 'D', path: '\\misc\\sunset-deck.jpg', mtime: '2024-04-22', score: 33 },
      ],
    },
    {
      id: 'g5', hash: '2e4a91…cb0d', size: 312, count: 2, reclaim: 312, category: 'video',
      copies: [
        { drive: 'N', path: '\\Videos\\2023\\08\\family-reunion.mov', mtime: '2023-08-12', score: 86, keeper: true },
        { drive: 'E', path: '\\incoming\\family-reunion.mov', mtime: '2023-08-13', score: 44 },
      ],
    },
    {
      id: 'g6', hash: '88af20…e451', size: 0.08, count: 12, reclaim: 0.88, category: 'document',
      copies: Array.from({length: 12}, (_, i) => ({ drive: 'D', path: `\\projects\\proj-${i}\\README.md`, mtime: '2024-09-01', score: i === 0 ? 60 : 20, keeper: i === 0 })),
    },
  ];

  const rules = [
    { id: 'r1', name: 'Photos by year/month', priority: 10, enabled: true, category: 'images', dest: 'media-archive', template: 'Photos/{year}/{month:02}/{filename}', policy: 'cross-drive-review', wouldMatch: 18421, matches: 18421, plannedOps: 2103 },
    { id: 'r2', name: 'Videos by year/month', priority: 20, enabled: true, category: 'video', dest: 'media-archive', template: 'Videos/{year}/{month:02}/{filename}', policy: 'cross-drive-review', wouldMatch: 412, matches: 412, plannedOps: 89 },
    { id: 'r3', name: 'Recent docs', priority: 30, enabled: true, category: 'documents', dest: 'active-documents', template: 'Documents/{category}/{filename}', policy: 'same-drive-auto', wouldMatch: 2104, matches: 2104, plannedOps: 184 },
    { id: 'r4', name: 'Archive docs (>2y)', priority: 40, enabled: true, category: 'documents', dest: 'document-archive', template: 'Documents/_archive/{year}/{category}/{filename}', policy: 'cross-drive-review', wouldMatch: 8920, matches: 8920, plannedOps: 1402 },
    { id: 'r5', name: 'Audio archive', priority: 50, enabled: true, category: 'audio', dest: 'media-archive', template: 'Music/{year}/{filename}', policy: 'cross-drive-review', wouldMatch: 3201, matches: 3201, plannedOps: 712 },
    { id: 'r6', name: 'Loose desktop dump', priority: 5, enabled: false, category: 'any', dest: 'active-documents', template: 'Inbox/{filename}', policy: 'always-review', wouldMatch: 84, matches: 0, plannedOps: 0, shadow: true },
  ];

  const planSample = [
    { src: 'C:\\Users\\curt\\Desktop\\IMG_8921.jpg', dest: 'E:\\Photos\\2024\\10\\IMG_8921.jpg', rule: 'Photos by year/month', size: 4.2, kind: 'cross-drive-move' },
    { src: 'C:\\Users\\curt\\Desktop\\IMG_8922.jpg', dest: 'E:\\Photos\\2024\\10\\IMG_8922.jpg', rule: 'Photos by year/month', size: 3.8, kind: 'cross-drive-move' },
    { src: 'D:\\downloads\\contract-final.pdf', dest: 'D:\\Documents\\documents\\contract-final.pdf', rule: 'Recent docs', size: 0.4, kind: 'same-drive-move' },
    { src: 'D:\\old-imports\\trip-2018.mov', dest: 'Z:\\Videos\\2018\\07\\trip-2018.mov', rule: 'Videos by year/month', size: 824, kind: 'cross-drive-move' },
    { src: 'D:\\Receipts\\2020\\amazon.pdf', dest: 'E:\\Documents\\_archive\\2020\\documents\\amazon.pdf', rule: 'Archive docs (>2y)', size: 0.1, kind: 'cross-drive-move' },
    { src: 'D:\\Receipts\\2020\\target.pdf', dest: 'E:\\Documents\\_archive\\2020\\documents\\target.pdf', rule: 'Archive docs (>2y)', size: 0.1, kind: 'cross-drive-move' },
    { src: 'D:\\music\\Wilco - Sky Blue Sky\\01.flac', dest: 'E:\\Music\\2007\\01.flac', rule: 'Audio archive', size: 32.1, kind: 'cross-drive-move' },
    { src: 'D:\\writing\\novel-draft-3.docx', dest: 'D:\\Documents\\documents\\novel-draft-3.docx', rule: 'Recent docs', size: 1.2, kind: 'same-drive-move' },
  ];

  const activity = [
    { t: '13:42:01', kind: 'scan', msg: 'Pylon NAS · indexed 124,201 / ~291,000 files', drive: 'N' },
    { t: '13:38:14', kind: 'throttle', msg: 'Auto-switched to balanced (workday window)', drive: null },
    { t: '13:21:09', kind: 'dedupe', msg: 'Detected 6 new duplicate groups (2.83 GB reclaimable)', drive: null },
    { t: '12:55:30', kind: 'apply', msg: 'Batch b-9341 completed · 184 same-drive moves', drive: 'D' },
    { t: '11:02:18', kind: 'scan', msg: 'Workhorse · scan completed (412,981 files, 14m 22s)', drive: 'D' },
  ];

  const summary = {
    totalFiles: 1284921,
    totalBytes: 14550, // GB
    duplicatesReclaimable: 28.4, // GB
    duplicateGroups: 412,
    unsorted: 24102,
    pendingReview: 2103,
    quarantineBytes: 4.2, // GB
    quarantineFiles: 1284,
  };

  return { drives, driveMap, dupGroups, rules, planSample, activity, summary };
})();
