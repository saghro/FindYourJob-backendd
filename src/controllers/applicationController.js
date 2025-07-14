// controllers/applicationController.js
const Application = require('../models/Application');
const Job = require('../models/Job');
const { catchAsync, AppError, sendResponse, getPaginationMeta } = require('../utils/helpers');
const { 
  uploadApplicationFiles, 
  handleUploadError, 
  cleanupFiles, 
  validateApplicationWithFiles 
} = require('../middleware/uploadMiddleware');

// Créer une nouvelle candidature
const createApplication = catchAsync(async (req, res, next) => {
  console.log('Creating application for user:', req.user._id);
  console.log('Request body:', req.body);
  console.log('Uploaded files:', req.files);

  try {
    // Extraire les données du formulaire
    const {
      jobId,
      coverLetter,
      personalInfo,
      expectedSalary,
      availability,
      experience,
      skills,
      education,
      languages,
      questionnaire
    } = req.body;

    // Validation de base
    if (!jobId) {
      return next(new AppError('Job ID is required', 400));
    }

    if (!personalInfo) {
      return next(new AppError('Personal information is required', 400));
    }

    // Vérifier que le job existe
    const job = await Job.findById(jobId);
    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Vérifier que l'utilisateur n'a pas déjà postulé
    const existingApplication = await Application.findOne({
      applicant: req.user._id,
      job: jobId
    });

    if (existingApplication) {
      return next(new AppError('You have already applied for this job', 409));
    }

    // Parser les données JSON si elles sont des strings
    let parsedPersonalInfo, parsedExpectedSalary, parsedAvailability, parsedExperience, parsedSkills, parsedEducation, parsedLanguages, parsedQuestionnaire;

    try {
      parsedPersonalInfo = typeof personalInfo === 'string' ? JSON.parse(personalInfo) : personalInfo;
      parsedExpectedSalary = expectedSalary ? (typeof expectedSalary === 'string' ? JSON.parse(expectedSalary) : expectedSalary) : undefined;
      parsedAvailability = availability ? (typeof availability === 'string' ? JSON.parse(availability) : availability) : undefined;
      parsedExperience = experience ? (typeof experience === 'string' ? JSON.parse(experience) : experience) : undefined;
      parsedSkills = skills ? (typeof skills === 'string' ? JSON.parse(skills) : skills) : undefined;
      parsedEducation = education ? (typeof education === 'string' ? JSON.parse(education) : education) : undefined;
      parsedLanguages = languages ? (typeof languages === 'string' ? JSON.parse(languages) : languages) : undefined;
      parsedQuestionnaire = questionnaire ? (typeof questionnaire === 'string' ? JSON.parse(questionnaire) : questionnaire) : undefined;
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return next(new AppError('Invalid JSON format in form data', 400));
    }

    // Préparer les données de l'application
    const applicationData = {
      applicant: req.user._id,
      job: jobId,
      status: 'pending',
      personalInfo: parsedPersonalInfo,
      coverLetter: coverLetter || ''
    };

    // Ajouter les données optionnelles si présentes
    if (parsedExpectedSalary) applicationData.expectedSalary = parsedExpectedSalary;
    if (parsedAvailability) applicationData.availability = parsedAvailability;
    if (parsedExperience) applicationData.experience = parsedExperience;
    if (parsedSkills) applicationData.skills = parsedSkills;
    if (parsedEducation) applicationData.education = parsedEducation;
    if (parsedLanguages) applicationData.languages = parsedLanguages;
    if (parsedQuestionnaire) applicationData.questionnaire = parsedQuestionnaire;

    // Gérer les fichiers uploadés
    if (req.files) {
      // CV
      if (req.files.resume && req.files.resume[0]) {
        const resumeFile = req.files.resume[0];
        applicationData.resume = {
          filename: resumeFile.filename,
          originalName: resumeFile.originalname,
          mimetype: resumeFile.mimetype,
          size: resumeFile.size,
          url: `/uploads/resumes/${resumeFile.filename}`
        };
      }

      // Portfolio - peut venir sous le nom 'portfolio' ou 'additionalDocuments'
      const portfolioFiles = req.files.portfolio || req.files.additionalDocuments;
      if (portfolioFiles && portfolioFiles.length > 0) {
        applicationData.additionalDocuments = portfolioFiles.map(file => ({
          filename: file.filename,
          originalName: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url: `/uploads/portfolios/${file.filename}`,
          type: 'portfolio'
        }));
      }
    }

    console.log('Application data prepared:', applicationData);

    // Créer l'application
    const application = new Application(applicationData);
    await application.save();

    // Populer les données pour la réponse
    const populatedApplication = await Application.findById(application._id)
      .populate('applicant', 'firstName lastName email')
      .populate('job', 'title company location type');

    console.log('Application created successfully:', application._id);

    sendResponse(res, 201, 'success', 'Application submitted successfully', {
      application: populatedApplication
    });

  } catch (error) {
    console.error('Create application error:', error);
    
    // Supprimer les fichiers uploadés en cas d'erreur
    if (req.files) {
      const fs = require('fs');
      Object.values(req.files).flat().forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (unlinkError) {
          console.error('Error deleting uploaded file:', unlinkError);
        }
      });
    }
    
    return next(new AppError('Failed to submit application', 500));
  }
});

// Obtenir mes candidatures
const getMyApplications = catchAsync(async (req, res, next) => {
  console.log('Fetching applications for user:', req.user._id);

  try {
    const {
      status = '',
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Filtre de base
    const filter = { applicant: req.user._id };

    // Filtre par statut
    if (status) {
      filter.status = status;
    }

    // Construction du tri
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Requête
    const [applications, totalResults] = await Promise.all([
      Application.find(filter)
        .populate('job', 'title company location type salary status')
        .populate({
          path: 'job',
          populate: {
            path: 'company',
            select: 'name logo'
          }
        })
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(filter)
    ]);

    // Enrichir avec des informations supplémentaires
    const enrichedApplications = applications.map(app => ({
      ...app,
      daysAgo: Math.floor((new Date() - new Date(app.createdAt)) / (1000 * 60 * 60 * 24)),
      canWithdraw: ['pending', 'reviewing'].includes(app.status)
    }));

    const pagination = getPaginationMeta(totalResults, pageNum, limitNum);

    sendResponse(res, 200, 'success', 'Applications retrieved successfully', {
      applications: enrichedApplications,
      pagination
    });

  } catch (error) {
    console.error('Get my applications error:', error);
    return next(new AppError('Failed to retrieve applications', 500));
  }
});

// Obtenir les candidatures pour un job (pour les employeurs)
const getJobApplications = catchAsync(async (req, res, next) => {
  const { jobId } = req.params;

  console.log('Fetching applications for job:', jobId);

  try {
    // Vérifier que le job existe et appartient à l'utilisateur
    const job = await Job.findById(jobId);
    if (!job) {
      return next(new AppError('Job not found', 404));
    }

    // Vérifier les permissions
    if (job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('You can only view applications for your own jobs', 403));
    }

    const {
      status = '',
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Filtre de base
    const filter = { job: jobId };

    // Filtre par statut
    if (status) {
      filter.status = status;
    }

    // Construction du tri
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Requête
    const [applications, totalResults] = await Promise.all([
      Application.find(filter)
        .populate('applicant', 'firstName lastName email profile')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Application.countDocuments(filter)
    ]);

    // Enrichir avec des informations supplémentaires
    const enrichedApplications = applications.map(app => ({
      ...app,
      daysAgo: Math.floor((new Date() - new Date(app.createdAt)) / (1000 * 60 * 60 * 24)),
      compatibilityScore: app.calculateCompatibilityScore ? app.calculateCompatibilityScore(job) : 0
    }));

    const pagination = getPaginationMeta(totalResults, pageNum, limitNum);

    sendResponse(res, 200, 'success', 'Job applications retrieved successfully', {
      applications: enrichedApplications,
      pagination,
      job: {
        _id: job._id,
        title: job.title,
        totalApplications: totalResults
      }
    });

  } catch (error) {
    console.error('Get job applications error:', error);
    return next(new AppError('Failed to retrieve job applications', 500));
  }
});

// Mettre à jour le statut d'une candidature (pour les employeurs)
const updateApplicationStatus = catchAsync(async (req, res, next) => {
  const { id } = req.params;
  const { status, notes = '' } = req.body;

  console.log('Updating application status:', id, status);

  try {
    // Trouver l'application et populer le job
    const application = await Application.findById(id).populate('job');
    if (!application) {
      return next(new AppError('Application not found', 404));
    }

    // Vérifier les permissions
    if (application.job.postedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return next(new AppError('You can only update applications for your own jobs', 403));
    }

    // Mettre à jour le statut
    await application.updateStatus(status, notes, req.user._id);

    // Recharger avec les données populées
    const updatedApplication = await Application.findById(id)
      .populate('applicant', 'firstName lastName email')
      .populate('job', 'title company');

    console.log('Application status updated successfully:', id);

    sendResponse(res, 200, 'success', 'Application status updated successfully', {
      application: updatedApplication
    });

  } catch (error) {
    console.error('Update application status error:', error);
    return next(new AppError('Failed to update application status', 500));
  }
});

// Retirer une candidature (pour les candidats)
const withdrawApplication = catchAsync(async (req, res, next) => {
  const { id } = req.params;

  console.log('Withdrawing application:', id);

  try {
    // Trouver l'application
    const application = await Application.findById(id);
    if (!application) {
      return next(new AppError('Application not found', 404));
    }

    // Vérifier les permissions
    if (application.applicant.toString() !== req.user._id.toString()) {
      return next(new AppError('You can only withdraw your own applications', 403));
    }

    // Vérifier que l'application peut être retirée
    if (!['pending', 'reviewing'].includes(application.status)) {
      return next(new AppError('This application cannot be withdrawn', 400));
    }

    // Mettre à jour le statut
    await application.updateStatus('withdrawn', 'Application withdrawn by candidate', req.user._id);

    console.log('Application withdrawn successfully:', id);

    sendResponse(res, 200, 'success', 'Application withdrawn successfully', {
      application
    });

  } catch (error) {
    console.error('Withdraw application error:', error);
    return next(new AppError('Failed to withdraw application', 500));
  }
});

// Obtenir les statistiques des candidatures
const getApplicationStats = catchAsync(async (req, res, next) => {
  try {
    let filter = {};
    
    // Si c'est un candidat, seulement ses candidatures
    if (req.user.role === 'candidate') {
      filter.applicant = req.user._id;
    }
    // Si c'est un employeur, seulement les candidatures pour ses jobs
    else if (req.user.role === 'employer') {
      const userJobs = await Job.find({ postedBy: req.user._id }).select('_id');
      const jobIds = userJobs.map(job => job._id);
      filter.job = { $in: jobIds };
    }
    // Les admins voient toutes les statistiques

    const stats = await Application.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          pendingApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          reviewingApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'reviewing'] }, 1, 0] }
          },
          shortlistedApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'shortlisted'] }, 1, 0] }
          },
          interviewedApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'interviewed'] }, 1, 0] }
          },
          offeredApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'offered'] }, 1, 0] }
          },
          rejectedApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
          },
          withdrawnApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'withdrawn'] }, 1, 0] }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalApplications: 0,
      pendingApplications: 0,
      reviewingApplications: 0,
      shortlistedApplications: 0,
      interviewedApplications: 0,
      offeredApplications: 0,
      rejectedApplications: 0,
      withdrawnApplications: 0
    };

    sendResponse(res, 200, 'success', 'Application statistics retrieved successfully', {
      stats: result
    });

  } catch (error) {
    console.error('Get application stats error:', error);
    return next(new AppError('Failed to retrieve application statistics', 500));
  }
});

module.exports = {
  createApplication,
  getMyApplications,
  getJobApplications,
  updateApplicationStatus,
  withdrawApplication,
  getApplicationStats,
  uploadFiles: uploadApplicationFiles, // Utiliser le middleware d'upload
  handleUploadError,
  cleanupFiles,
  validateApplicationWithFiles
};