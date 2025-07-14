// routes/applications.js
const express = require('express');
const applicationController = require('../controllers/applicationController');
const { auth, authorize } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { applicationValidators } = require('../utils/validators');

const router = express.Router();

// Toutes les routes nécessitent une authentification
router.use(auth);

// Route de test
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Application routes are working!', 
    timestamp: new Date(),
    user: {
      id: req.user._id,
      role: req.user.role,
      email: req.user.email
    },
    endpoints: [
      'GET /applications/my - Get my applications',
      'POST /applications - Create application',
      'GET /applications/job/:jobId - Get job applications (employer)',
      'PUT /applications/:id/status - Update application status (employer)',
      'PUT /applications/:id/withdraw - Withdraw application (candidate)',
      'GET /applications/stats - Get application statistics'
    ]
  });
});

// Routes pour les candidats

// Obtenir mes candidatures
router.get('/my', 
  authorize('candidate', 'admin'), 
  applicationController.getMyApplications
);

// Créer une nouvelle candidature avec upload de fichiers
router.post('/', 
  authorize('candidate', 'admin'),
  applicationController.cleanupFiles, // Nettoyage en cas d'erreur
  (req, res, next) => {
    // Utiliser le middleware d'upload avec gestion d'erreurs
    applicationController.uploadFiles(req, res, (err) => {
      if (err) {
        return applicationController.handleUploadError(err, req, res, next);
      }
      next();
    });
  },
  applicationController.validateApplicationWithFiles, // Validation des données
  applicationController.createApplication
);

// Retirer une candidature
router.put('/:id/withdraw',
  authorize('candidate', 'admin'),
  applicationController.withdrawApplication
);

// Routes pour les employeurs

// Obtenir les candidatures pour un job spécifique
router.get('/job/:jobId',
  authorize('employer', 'admin'),
  applicationController.getJobApplications
);

// Mettre à jour le statut d'une candidature
router.put('/:id/status',
  authorize('employer', 'admin'),
  validate(applicationValidators.updateApplicationStatus),
  applicationController.updateApplicationStatus
);

// Routes communes

// Obtenir les statistiques des candidatures
router.get('/stats',
  applicationController.getApplicationStats
);

module.exports = router;