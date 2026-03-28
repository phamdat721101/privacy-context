import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chatRouter } from './routes/chat';
import { permitRouter } from './routes/permit';
import { memoryRouter } from './routes/memory';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.use('/chat', chatRouter);
app.use('/permit', permitRouter);
app.use('/memory', memoryRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Agent backend running on port ${PORT}`);
});
