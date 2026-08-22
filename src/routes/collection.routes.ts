import { Router } from 'express';
import { CollectionController } from '../controllers/collection.controller';

const router = Router();

router.get('/', CollectionController.listCollections);

export default router;
