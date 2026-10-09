
export default function authMiddleware(req,res,next){
    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
  return res.status(401).json({ error: 'Authentication required' });
}