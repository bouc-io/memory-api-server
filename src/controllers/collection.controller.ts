import { Request, Response } from 'express';

export class CollectionController {
    static async listCollections(req: Request, res: Response) {
        res.status(501).json({ error: 'Not Implemented' });
    }
}
