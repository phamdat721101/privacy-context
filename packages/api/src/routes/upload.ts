import { Router, Request } from 'express';
import multer from 'multer';
import { auth, AuthRequest } from '../middleware/auth';
import { KnowledgeIngestService } from '../services/knowledge-ingest';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(auth);

router.post('/', upload.single('file'), async (req: Request, res) => {
  const authReq = req as AuthRequest;
  const file = (req as any).file;
  if (!file) return res.status(400).json({ error: 'No file provided' });

  const content = file.buffer.toString('utf-8');
  const brainId = req.body.brainId ? +req.body.brainId : null;
  const chain = (req.headers['x-chain'] as string) || 'arbitrum-sepolia';

  const result = await KnowledgeIngestService.ingestFile(authReq.user!.address, content, brainId, chain);
  res.json(result);
});

export default router;
