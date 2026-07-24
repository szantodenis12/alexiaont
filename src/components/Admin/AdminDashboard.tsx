import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, orderBy, onSnapshot, doc, updateDoc, deleteDoc, getDocs, where, setDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../../firebase/config';
import JSZip from 'jszip';
import { 
  LogOut, Plus, Lock, Unlock, Copy, ExternalLink, 
  RefreshCw, FileText, Download, Check, AlertCircle, Eye, Search, X,
  Folder, FolderOpen, ChevronRight, ChevronDown, ArrowLeft, Calendar, File, Trash2,
  Settings, Upload, Image as ImageIcon
} from 'lucide-react';
import { applyWatermark } from '../../utils/watermarkProcessor';
interface ClassData {
  id: string;
  schoolName: string;
  diriginteName: string;
  studentList: string[];
  status: 'active' | 'locked';
  requireEmailDownload: boolean;
  extraPagesPrice: number;
  galleryPhotos?: any[];
  galleryType?: 'flat' | 'folder';
  deadline?: any;
  createdAt?: any;
}

interface DownloadLog {
  id: string;
  classId: string;
  schoolName?: string;
  email: string;
  filesList: string[];
  downloadedAt: any;
}

export const AdminDashboard: React.FC = () => {
  const [classes, setClasses] = useState<ClassData[]>([]);
  const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, any>>({});
  const [selectedClass, setSelectedClass] = useState<ClassData | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<any | null>(null);
  const [expandedStudent, setExpandedStudent] = useState<string | null>(null);
  const [searchStudentQuery, setSearchStudentQuery] = useState('');
  const [searchClassQuery, setSearchClassQuery] = useState('');
  const [studentZipProgress, setStudentZipProgress] = useState<Record<string, number>>({});
  const [classZipProgress, setClassZipProgress] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'classes' | 'logs' | 'galleries' | 'watermark'>('classes');
  const [copiedId, setCopiedId] = useState<{ id: string; type: 'config' | 'gallery' | 'public_gallery' } | null>(null);
  
  // Photo Galleries States
  const [photoGalleries, setPhotoGalleries] = useState<any[]>([]);
  const [watermarkSettings, setWatermarkSettings] = useState<any | null>(null);
  const [albumWatermark, setAlbumWatermark] = useState<any | null>(null);
  const [watermarkError, setWatermarkError] = useState<string | null>(null);
  const [galleriesError, setGalleriesError] = useState<string | null>(null);
  const [isUploadingWatermark, setIsUploadingWatermark] = useState(false);
  const [watermarkUploadProgress, setWatermarkUploadProgress] = useState<number | null>(null);
  const [isUploadingAlbumWatermark, setIsUploadingAlbumWatermark] = useState(false);
  const [albumWatermarkUploadProgress, setAlbumWatermarkUploadProgress] = useState<number | null>(null);
  const [applyAlbumWatermarkToggle, setApplyAlbumWatermarkToggle] = useState(false);
  const [searchGalleryQuery, setSearchGalleryQuery] = useState('');
  
  // Gallery Duplication States
  const [duplicatingGallery, setDuplicatingGallery] = useState<any | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [duplicateProgress, setDuplicateProgress] = useState({ current: 0, total: 0 });
  const [duplicateOptions, setDuplicateOptions] = useState({ cover: true, settings: true, folders: true, photos: true });
  
  // Gallery Creation States
  const [showCreateGalleryModal, setShowCreateGalleryModal] = useState(false);
  const [newGalleryTitle, setNewGalleryTitle] = useState('');
  const [newGallerySubtitle, setNewGallerySubtitle] = useState('');
  const [newGalleryDate, setNewGalleryDate] = useState(new Date().toISOString().split('T')[0]);
  const [newGalleryWatermark, setNewGalleryWatermark] = useState(false);
  const [isCreatingGallery, setIsCreatingGallery] = useState(false);
  
  // Photographer Profile States
  const [photographerProfile, setPhotographerProfile] = useState<{ name: string; avatarUrl: string; avatarPath: string; link: string } | null>(null);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [profileLinkInput, setProfileLinkInput] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState<number | null>(null);
  
  // Gallery Management States
  const [isDeletingPhoto, setIsDeletingPhoto] = useState<string | null>(null);
  const [isUploadingMore, setIsUploadingMore] = useState(false);
  const [moreUploadProgress, setMoreUploadProgress] = useState<Record<string, { name: string; progress: number; status: 'pending' | 'uploading' | 'completed' | 'error' }>>({});
  const [showAddPhotosForm, setShowAddPhotosForm] = useState(false);
  
  const navigate = useNavigate();

  useEffect(() => {
    // Auth route guard
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate('/admin/login');
      }
    });

    // Subscriptions to Firestore data
    const classesQuery = query(collection(db, 'classes'), orderBy('createdAt', 'desc'));
    const unsubscribeClasses = onSnapshot(
      classesQuery, 
      (snapshot) => {
        const classesData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ClassData[];
        setClasses(classesData);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to classes:', err);
        setError('Eroare conexiune Firestore (clase): ' + err.message);
        setLoading(false);
      }
    );

    const logsQuery = query(collection(db, 'downloads'), orderBy('downloadedAt', 'desc'));
    const unsubscribeLogs = onSnapshot(
      logsQuery, 
      (snapshot) => {
        const logsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as DownloadLog[];
        setDownloadLogs(logsData);
      },
      (err) => {
        console.error('Error listening to logs:', err);
      }
    );

    const submissionsQuery = query(collection(db, 'submissions'));
    const unsubscribeSubmissions = onSnapshot(
      submissionsQuery,
      (snapshot) => {
        const subsMap: Record<string, any> = {};
        snapshot.docs.forEach(doc => {
          subsMap[doc.id] = doc.data(); // Key: classId_studentName
        });
        setSubmissions(subsMap);
      },
      (err) => {
        console.error('Error listening to submissions:', err);
      }
    );

    const galleriesQuery = query(collection(db, 'photo_galleries'));
    const unsubscribeGalleries = onSnapshot(
      galleriesQuery,
      (snapshot) => {
        setGalleriesError(null);
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));
        list.sort((a: any, b: any) => {
          const dateA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
          const dateB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
          return dateB - dateA;
        });
        setPhotoGalleries(list);
      },
      (err) => {
        console.error('Error listening to photo galleries:', err);
        setGalleriesError(err.message);
      }
    );

    const unsubscribeSettings = onSnapshot(
      doc(db, 'settings', 'global'),
      (docSnap) => {
        setWatermarkError(null);
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.defaultWatermark) {
            setWatermarkSettings(data.defaultWatermark);
          } else {
            setWatermarkSettings(null);
          }
          if (data.albumWatermark) {
            setAlbumWatermark(data.albumWatermark);
          } else {
            setAlbumWatermark(null);
          }
          if (data.photographerProfile) {
            setPhotographerProfile(data.photographerProfile);
            setProfileNameInput(data.photographerProfile.name || '');
            setProfileLinkInput(data.photographerProfile.link || '');
          } else {
            setPhotographerProfile(null);
          }
        } else {
          setWatermarkSettings(null);
          setAlbumWatermark(null);
          setPhotographerProfile(null);
        }
      },
      (err) => {
        console.error('Error listening to settings:', err);
        setWatermarkError(err.message);
      }
    );

    return () => {
      unsubscribeAuth();
      unsubscribeClasses();
      unsubscribeLogs();
      unsubscribeSubmissions();
      unsubscribeGalleries();
      unsubscribeSettings();
    };
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/admin/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const downloadStudentZip = async (studentName: string, sub: any) => {
    setStudentZipProgress(prev => ({ ...prev, [studentName]: 1 }));
    const zip = new JSZip();

    try {
      const filesToDownload: { url: string; name: string }[] = [];

      if (sub.copertaPhoto) {
        filesToDownload.push({
          url: sub.copertaPhoto.processedUrl || sub.copertaPhoto.url,
          name: sub.copertaPhoto.name ? `coperta_${sub.copertaPhoto.bw ? 'bw_' : ''}${sub.copertaPhoto.name}` : `coperta_${sub.copertaPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      if (sub.colegiPhoto) {
        filesToDownload.push({
          url: sub.colegiPhoto.processedUrl || sub.colegiPhoto.url,
          name: sub.colegiPhoto.name ? `colegi_${sub.colegiPhoto.bw ? 'bw_' : ''}${sub.colegiPhoto.name}` : `colegi_${sub.colegiPhoto.bw ? 'bw' : 'color'}.jpg`
        });
      }

      if (sub.personalPhotos && Array.isArray(sub.personalPhotos)) {
        sub.personalPhotos.forEach((photo: any, index: number) => {
          filesToDownload.push({
            url: photo.processedUrl || photo.url,
            name: photo.name ? `personal_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `personal_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
          });
        });
      }

      if (sub.extraPhotos && Array.isArray(sub.extraPhotos)) {
        sub.extraPhotos.forEach((photo: any, index: number) => {
          filesToDownload.push({
            url: photo.processedUrl || photo.url,
            name: photo.name ? `extra_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `extra_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
          });
        });
      }

      // Add text details
      const infoText = `Elev: ${studentName}\nNume pe album: ${sub.albumName || studentName}\nScoala: ${selectedClass?.schoolName || ''}\nDiriginte: ${selectedClass?.diriginteName || ''}\nCitat: "${sub.citat || ''}"\nObservatii: ${sub.observatii || ''}\nExtra pagini: ${sub.extraPagesEnabled ? 'Da' : 'Nu'}\n`;
      zip.file('citat_si_observatii.txt', infoText);

      // Download files
      for (let i = 0; i < filesToDownload.length; i++) {
        const file = filesToDownload[i];
        const response = await fetch(file.url);
        const blob = await response.blob();
        zip.file(file.name, blob);
        
        const progress = Math.round(((i + 1) / filesToDownload.length) * 100);
        setStudentZipProgress(prev => ({ ...prev, [studentName]: progress }));
      }

      setStudentZipProgress(prev => ({ ...prev, [studentName]: 100 }));
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${studentName.replace(/[^a-z0-9]/gi, '_')}_selectie_album.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Error generating student ZIP:', err);
      alert('Descărcarea a eșuat. Verifică dacă CORS este activat pe bucket-ul Storage.');
    } finally {
      setStudentZipProgress(prev => {
        const copy = { ...prev };
        delete copy[studentName];
        return copy;
      });
    }
  };

  const downloadClassZip = async () => {
    if (!selectedClass) return;
    const classSubs = Object.values(submissions).filter(sub => sub.classId === selectedClass.id);
    if (classSubs.length === 0) {
      alert('Nu există nicio trimitere pentru această clasă.');
      return;
    }

    setClassZipProgress(1);
    const zip = new JSZip();
    
    // Create root folder named after school and homeroom teacher
    const rootName = `${selectedClass.schoolName}_${selectedClass.diriginteName}`.replace(/[^a-z0-9]/gi, '_');
    const classFolder = zip.folder(rootName);
    if (!classFolder) throw new Error('Nu s-a putut crea folderul principal în ZIP.');

    try {
      // 1. First, compile the list of all files to download and prepare student folders
      const allDownloads: { url: string; folder: any; name: string }[] = [];

      classSubs.forEach(sub => {
        const studentFolder = classFolder.folder(sub.studentName.replace(/[^a-z0-9]/gi, '_'));
        if (!studentFolder) return;
        
        // Add txt file
        const infoText = `Elev: ${sub.studentName}\nNume pe album: ${sub.albumName || sub.studentName}\nScoala: ${selectedClass.schoolName}\nDiriginte: ${selectedClass.diriginteName}\nCitat: "${sub.citat || ''}"\nObservatii: ${sub.observatii || ''}\nExtra pagini: ${sub.extraPagesEnabled ? 'Da' : 'Nu'}\n`;
        studentFolder.file('citat_si_observatii.txt', infoText);

        if (sub.copertaPhoto) {
          allDownloads.push({
            url: sub.copertaPhoto.processedUrl || sub.copertaPhoto.url,
            folder: studentFolder,
            name: sub.copertaPhoto.name ? `coperta_${sub.copertaPhoto.bw ? 'bw_' : ''}${sub.copertaPhoto.name}` : `coperta_${sub.copertaPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.colegiPhoto) {
          allDownloads.push({
            url: sub.colegiPhoto.processedUrl || sub.colegiPhoto.url,
            folder: studentFolder,
            name: sub.colegiPhoto.name ? `colegi_${sub.colegiPhoto.bw ? 'bw_' : ''}${sub.colegiPhoto.name}` : `colegi_${sub.colegiPhoto.bw ? 'bw' : 'color'}.jpg`
          });
        }
        if (sub.personalPhotos && Array.isArray(sub.personalPhotos)) {
          sub.personalPhotos.forEach((photo: any, index: number) => {
            allDownloads.push({
              url: photo.processedUrl || photo.url,
              folder: studentFolder,
              name: photo.name ? `personal_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `personal_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
            });
          });
        }
        if (sub.extraPhotos && Array.isArray(sub.extraPhotos)) {
          sub.extraPhotos.forEach((photo: any, index: number) => {
            allDownloads.push({
              url: photo.processedUrl || photo.url,
              folder: studentFolder,
              name: photo.name ? `extra_${index + 1}_${photo.bw ? 'bw_' : ''}${photo.name}` : `extra_${index + 1}_${photo.bw ? 'bw' : 'color'}.jpg`
            });
          });
        }
      });

      const totalFiles = allDownloads.length;

      // 2. Fetch and add files
      for (let i = 0; i < totalFiles; i++) {
        const item = allDownloads[i];
        const response = await fetch(item.url);
        const blob = await response.blob();
        item.folder.file(item.name, blob);

        const progress = Math.round(((i + 1) / totalFiles) * 100);
        setClassZipProgress(progress);
      }

      // 3. Generate ZIP blob
      const content = await zip.generateAsync({ type: 'blob' });
      const blobUrl = window.URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${rootName}_toate_albumele.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);

    } catch (err) {
      console.error('Error generating class ZIP:', err);
      alert('Descărcarea a eșuat. Verifică dacă CORS este activat pe bucket-ul Storage.');
    } finally {
      setClassZipProgress(null);
    }
  };

  const toggleClassStatus = async (classId: string, currentStatus: 'active' | 'locked') => {
    try {
      const classRef = doc(db, 'classes', classId);
      const nextStatus = currentStatus === 'active' ? 'locked' : 'active';
      await updateDoc(classRef, {
        status: nextStatus
      });
      // Update selectedClass state if active
      if (selectedClass && selectedClass.id === classId) {
        setSelectedClass(prev => prev ? { ...prev, status: nextStatus } : null);
      }
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Eroare la actualizarea statusului clasei.');
    }
  };

  const toggleEmailDownload = async (classId: string, currentRequire: boolean) => {
    try {
      const classRef = doc(db, 'classes', classId);
      const nextRequire = !currentRequire;
      await updateDoc(classRef, {
        requireEmailDownload: nextRequire
      });
      // Update selectedClass state if active
      if (selectedClass && selectedClass.id === classId) {
        setSelectedClass(prev => prev ? { ...prev, requireEmailDownload: nextRequire } : null);
      }
    } catch (err) {
      console.error('Error updating email setting:', err);
      alert('Eroare la actualizarea setării de descărcare.');
    }
  };

  const deleteClass = async (classId: string) => {
    const confirmDelete = window.confirm(
      'Ești sigur că vrei să ștergi această clasă? Toate datele asociate (albume trimise, fișiere, istoric descărcări) vor fi șterse definitiv.'
    );
    if (!confirmDelete) return;

    try {
      // 1. Delete class document
      await deleteDoc(doc(db, 'classes', classId));

      // 2. Query and delete all submissions for this class
      const subsQuery = query(collection(db, 'submissions'), where('classId', '==', classId));
      const subsSnapshot = await getDocs(subsQuery);
      const subDeletes = subsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
      await Promise.all(subDeletes);

      // 3. Query and delete all downloads for this class
      const downloadsQuery = query(collection(db, 'downloads'), where('classId', '==', classId));
      const downloadsSnapshot = await getDocs(downloadsQuery);
      const downloadDeletes = downloadsSnapshot.docs.map(docSnap => deleteDoc(docSnap.ref));
      await Promise.all(downloadDeletes);

      // 4. Return to root view
      setSelectedClass(null);
      alert('Clasa a fost ștearsă cu succes.');
    } catch (err) {
      console.error('Error deleting class:', err);
      alert('Eroare la ștergerea clasei.');
    }
  };

  const handleDeletePhoto = async (photo: any) => {
    if (!selectedClass) return;
    if (!window.confirm(`Ești sigur că vrei să ștergi imaginea "${photo.name}"?`)) return;

    setIsDeletingPhoto(photo.path);
    try {
      // 1. Delete from storage
      const storageRef = ref(storage, photo.path);
      try {
        await deleteObject(storageRef);
      } catch (storageErr) {
        console.warn("Storage deletion warning (might not exist):", storageErr);
      }

      // 2. Delete from firestore
      const updatedPhotos = (selectedClass.galleryPhotos || []).filter((p: any) => p.path !== photo.path);
      await updateDoc(doc(db, 'classes', selectedClass.id), {
        galleryPhotos: updatedPhotos
      });

      // 3. Update local state
      setSelectedClass(prev => prev ? { ...prev, galleryPhotos: updatedPhotos } : null);
    } catch (err: any) {
      console.error("Error deleting photo:", err);
      alert(`Eroare la ștergerea fotografiei: ${err.message || err.toString()}`);
    } finally {
      setIsDeletingPhoto(null);
    }
  };

  const handleNewFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedClass || !e.target.files || e.target.files.length === 0) return;
    const filesArray = Array.from(e.target.files);

    setIsUploadingMore(true);
    
    // Initialize progress map
    const progressMap: Record<string, { name: string; progress: number; status: 'pending' | 'uploading' | 'completed' | 'error' }> = {};
    filesArray.forEach(file => {
      progressMap[file.name] = {
        name: file.name,
        progress: 0,
        status: 'pending'
      };
    });
    setMoreUploadProgress(progressMap);

    const newPhotos: any[] = [];

    try {
      for (const file of filesArray) {
        const storagePath = `classes/${selectedClass.id}/gallery/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, storagePath);

        setMoreUploadProgress(prev => ({
          ...prev,
          [file.name]: { ...prev[file.name], status: 'uploading' }
        }));

        let uploadBlob: Blob = file;
        try {
          const wmUrl = applyAlbumWatermarkToggle && albumWatermark ? albumWatermark.url : null;
          uploadBlob = await applyWatermark(
            file, 
            wmUrl, 
            albumWatermark?.position || 'bottom-right',
            albumWatermark?.offsetX || 0,
            albumWatermark?.offsetY || 0
          );
        } catch (wmErr) {
          console.error("Failed to optimize/watermark file:", file.name, wmErr);
        }

        const uploadTask = uploadBytesResumable(storageRef, uploadBlob);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setMoreUploadProgress(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], progress }
              }));
            },
            (error) => {
              console.error("Upload error for file:", file.name, error);
              setMoreUploadProgress(prev => ({
                ...prev,
                [file.name]: { ...prev[file.name], status: 'error' }
              }));
              reject(error);
            },
            async () => {
              try {
                const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                const relativePath = (file as any).webkitRelativePath || '';
                const pathParts = relativePath.split('/');
                const folderName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : '';

                newPhotos.push({
                  name: file.name,
                  url: downloadUrl,
                  path: storagePath,
                  ...(folderName ? { folder: folderName } : {})
                });

                setMoreUploadProgress(prev => ({
                  ...prev,
                  [file.name]: { ...prev[file.name], progress: 100, status: 'completed' }
                }));
                resolve();
              } catch (urlErr) {
                reject(urlErr);
              }
            }
          );
        });
      }

      // Save to Firestore
      const updatedPhotos = [...(selectedClass.galleryPhotos || []), ...newPhotos];
      await updateDoc(doc(db, 'classes', selectedClass.id), {
        galleryPhotos: updatedPhotos
      });

      setSelectedClass(prev => prev ? { ...prev, galleryPhotos: updatedPhotos } : null);
      setShowAddPhotosForm(false);
      setMoreUploadProgress({});
      alert("Fotografiile au fost adăugate cu succes!");
    } catch (err: any) {
      console.error("Error uploading photos:", err);
      alert(`Eroare la încărcare: ${err.message || err.toString()}`);
    } finally {
      setIsUploadingMore(false);
    }
  };

  const handleWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    setIsUploadingWatermark(true);
    setWatermarkUploadProgress(0);

    const storagePath = `settings/global/watermark_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      // Delete old watermark from storage if exists
      if (watermarkSettings?.path) {
        try {
          await deleteObject(ref(storage, watermarkSettings.path));
        } catch (oldErr) {
          console.warn("Could not delete old watermark file:", oldErr);
        }
      }

      const uploadTask = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setWatermarkUploadProgress(progress);
          },
          (error) => reject(error),
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const payload = {
                defaultWatermark: {
                  url,
                  path: storagePath,
                  name: file.name
                }
              };
              await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
              alert("Watermark-ul implicit a fost salvat!");
              resolve();
            } catch (urlErr) {
              reject(urlErr);
            }
          }
        );
      });
    } catch (err: any) {
      console.error("Error uploading watermark:", err);
      alert(`Încărcarea watermark-ului a eșuat: ${err.message || err.toString()}`);
    } finally {
      setIsUploadingWatermark(false);
      setWatermarkUploadProgress(null);
      if (e.target) e.target.value = ''; // clear input
    }
  };

  const handleWatermarkDelete = async () => {
    if (!watermarkSettings) return;
    if (!window.confirm("Ești sigur că vrei să ștergi watermark-ul implicit?")) return;

    try {
      // 1. Delete from Storage
      try {
        await deleteObject(ref(storage, watermarkSettings.path));
      } catch (storageErr) {
        console.warn("Storage delete watermark warning:", storageErr);
      }

      // 2. Remove from Firestore
      await setDoc(doc(db, 'settings', 'global'), { defaultWatermark: null }, { merge: true });
      alert("Watermark-ul implicit a fost șters!");
    } catch (err: any) {
      console.error("Error deleting watermark:", err);
      alert(`Ștergerea watermark-ului a eșuat: ${err.message || err.toString()}`);
    }
  };

  const handleAlbumWatermarkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    setIsUploadingAlbumWatermark(true);
    setAlbumWatermarkUploadProgress(0);

    const storagePath = `settings/global/album_watermark_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);

    try {
      // Delete old album watermark if exists
      if (albumWatermark?.path) {
        try {
          await deleteObject(ref(storage, albumWatermark.path));
        } catch (oldErr) {
          console.warn("Could not delete old album watermark file:", oldErr);
        }
      }

      const uploadTask = uploadBytesResumable(storageRef, file);

      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setAlbumWatermarkUploadProgress(progress);
          },
          (error) => reject(error),
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              const payload = {
                albumWatermark: {
                  url,
                  path: storagePath,
                  name: file.name,
                  position: albumWatermark?.position || 'bottom-right',
                  offsetX: albumWatermark?.offsetX || 0,
                  offsetY: albumWatermark?.offsetY || 0
                }
              };
              await setDoc(doc(db, 'settings', 'global'), payload, { merge: true });
              alert("Watermark-ul pentru albume a fost salvat!");
              resolve();
            } catch (urlErr) {
              reject(urlErr);
            }
          }
        );
      });
    } catch (err: any) {
      console.error("Error uploading album watermark:", err);
      alert(`Încărcarea watermark-ului a eșuat: ${err.message || err.toString()}`);
    } finally {
      setIsUploadingAlbumWatermark(false);
      setAlbumWatermarkUploadProgress(null);
      if (e.target) e.target.value = ''; // clear input
    }
  };

  const handleAlbumWatermarkDelete = async () => {
    if (!albumWatermark) return;
    if (!window.confirm("Ești sigur că vrei să ștergi watermark-ul pentru albume?")) return;

    try {
      try {
        await deleteObject(ref(storage, albumWatermark.path));
      } catch (storageErr) {
        console.warn("Storage delete watermark warning:", storageErr);
      }

      await setDoc(doc(db, 'settings', 'global'), { albumWatermark: null }, { merge: true });
      alert("Watermark-ul pentru albume a fost șters!");
    } catch (err: any) {
      console.error("Error deleting album watermark:", err);
      alert(`Ștergerea watermark-ului a eșuat: ${err.message || err.toString()}`);
    }
  };



  const handleDeleteGallery = async (gallery: any) => {
    if (!window.confirm(`Ești sigur că vrei să ștergi galeria "${gallery.title}"? Această acțiune va șterge toate pozele asociate din baza de date și din spațiul de stocare.`)) {
      return;
    }

    try {
      // 1. Delete from Firestore
      await deleteDoc(doc(db, 'photo_galleries', gallery.id));

      // 2. Delete Cover from Storage
      if (gallery.coverPhoto?.path) {
        try {
          await deleteObject(ref(storage, gallery.coverPhoto.path));
        } catch (e) {
          console.warn("Cover photo delete warning:", e);
        }
      }

      // 3. Delete Subcollections Photos from Storage
      if (gallery.subCollections) {
        for (const sub of gallery.subCollections) {
          if (sub.photos) {
            for (const photo of sub.photos) {
              try {
                await deleteObject(ref(storage, photo.path));
              } catch (e) {
                console.warn("Photo delete warning:", e);
              }
            }
          }
        }
      }

      alert("Galeria foto a fost ștearsă cu succes!");
    } catch (err: any) {
      console.error("Error deleting gallery:", err);
      alert(`Ștergerea galeriei a eșuat: ${err.message || err.toString()}`);
    }
  };

  const handleExecuteDuplicate = async (gallery: any, quick: boolean) => {
    setIsDuplicating(true);
    
    const options = quick 
      ? { cover: true, settings: true, folders: true, photos: true }
      : duplicateOptions;
      
    // Count total files to copy
    let totalFiles = 0;
    if (options.cover && gallery.coverPhoto) totalFiles++;
    if (options.folders && options.photos) {
      gallery.subCollections?.forEach((sub: any) => {
        totalFiles += (sub.photos?.length || 0);
      });
    }
    
    setDuplicateProgress({ current: 0, total: totalFiles });
    let currentProcessed = 0;
    
    try {
      const newGalleryId = doc(collection(db, 'photo_galleries')).id;
      
      const newPayload: any = {
        title: `${gallery.title} (Copie)`,
        subtitle: options.cover ? (gallery.subtitle || '') : '',
        date: new Date().toISOString().split('T')[0],
        coverPhoto: null,
        titleStyle: options.settings ? (gallery.titleStyle || {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        }) : {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        },
        watermarkEnabled: options.settings ? (gallery.watermarkEnabled || false) : false,
        watermarkPosition: options.settings ? (gallery.watermarkPosition || 'bottom-right') : 'bottom-right',
        subCollections: [],
        createdAt: new Date()
      };
      
      // 1. Copy Cover
      if (options.cover && gallery.coverPhoto) {
        try {
          const res = await fetch(gallery.coverPhoto.url);
          const blob = await res.blob();
          const newCoverPath = `galleries/${newGalleryId}/cover_${Date.now()}_cover.jpg`;
          const storageRef = ref(storage, newCoverPath);
          await uploadBytesResumable(storageRef, blob);
          const url = await getDownloadURL(storageRef);
          newPayload.coverPhoto = {
            url,
            path: newCoverPath,
            focalPoint: gallery.coverPhoto.focalPoint || { x: 50, y: 50 }
          };
        } catch (coverErr) {
          console.error("Error copying cover during duplicate:", coverErr);
        }
        currentProcessed++;
        setDuplicateProgress({ current: currentProcessed, total: totalFiles });
      }
      
      // 2. Copy Subcollections
      if (options.folders) {
        const subCollectionsList = gallery.subCollections || [];
        for (const sub of subCollectionsList) {
          const newPhotos: any[] = [];
          
          if (options.photos && sub.photos && sub.photos.length > 0) {
            for (const photo of sub.photos) {
              try {
                const res = await fetch(photo.url);
                const blob = await res.blob();
                const newPhotoPath = `galleries/${newGalleryId}/${sub.id}/${Date.now()}_${photo.name}`;
                const storageRef = ref(storage, newPhotoPath);
                await uploadBytesResumable(storageRef, blob);
                const url = await getDownloadURL(storageRef);
                newPhotos.push({
                  name: photo.name,
                  url,
                  path: newPhotoPath
                });
              } catch (photoErr) {
                console.error("Error copying photo during duplicate:", photo.name, photoErr);
              }
              currentProcessed++;
              setDuplicateProgress({ current: currentProcessed, total: totalFiles });
            }
          }
          
          newPayload.subCollections.push({
            id: sub.id,
            name: sub.name,
            photos: newPhotos
          });
        }
      } else {
        // If not copying folders, create a default folder
        newPayload.subCollections = [{ id: 'all', name: 'General', photos: [] }];
      }
      
      // 3. Save to Firestore
      await setDoc(doc(db, 'photo_galleries', newGalleryId), newPayload);
      alert('Galeria a fost duplicată cu succes!');
      setDuplicatingGallery(null);
    } catch (err) {
      console.error("Error duplicating gallery:", err);
      alert('Duplicarea galeriei a eșuat.');
    } finally {
      setIsDuplicating(false);
    }
  };

  const handleExecuteCreateGallery = async () => {
    const titleClean = newGalleryTitle.trim();
    if (!titleClean) {
      alert('Numele galeriei este obligatoriu.');
      return;
    }
    
    setIsCreatingGallery(true);
    
    try {
      const payload = {
        title: titleClean,
        subtitle: newGallerySubtitle.trim(),
        date: newGalleryDate,
        coverPhoto: null,
        titleStyle: {
          fontFamily: 'Outfit',
          fontSize: '42px',
          color: '#FAF9F6',
          position: 'bottom-left'
        },
        watermarkEnabled: newGalleryWatermark,
        watermarkPosition: 'bottom-right',
        subCollections: [{ id: 'all', name: 'General', photos: [] }],
        createdAt: new Date()
      };
      
      const docRef = await addDoc(collection(db, 'photo_galleries'), payload);
      
      // Reset state
      setShowCreateGalleryModal(false);
      setNewGalleryTitle('');
      setNewGallerySubtitle('');
      setNewGalleryDate(new Date().toISOString().split('T')[0]);
      setNewGalleryWatermark(false);
      
      // Redirect to the editor!
      navigate(`/admin/edit-photo-gallery/${docRef.id}`);
    } catch (err) {
      console.error("Error creating new gallery:", err);
      alert("Crearea galeriei a eșuat.");
    } finally {
      setIsCreatingGallery(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setIsUploadingAvatar(true);
    setAvatarUploadProgress(0);
    
    const storagePath = `settings/photographer_avatar_${Date.now()}_${file.name}`;
    const storageRef = ref(storage, storagePath);
    
    // Delete old avatar if it exists
    if (photographerProfile?.avatarPath) {
      try {
        await deleteObject(ref(storage, photographerProfile.avatarPath));
      } catch (oldErr) {
        console.warn("Could not delete old avatar file:", oldErr);
      }
    }
    
    const uploadTask = uploadBytesResumable(storageRef, file);
    
    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setAvatarUploadProgress(progress);
      },
      (error) => {
        console.error("Avatar upload error:", error);
        alert("Încărcarea pozei de profil a eșuat.");
        setIsUploadingAvatar(false);
        setAvatarUploadProgress(null);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          
          const updatedProfile = {
            name: profileNameInput.trim() || photographerProfile?.name || 'ALEXIA VISUAL ARTIST',
            link: profileLinkInput.trim() || photographerProfile?.link || '',
            avatarUrl: url,
            avatarPath: storagePath
          };
          
          await setDoc(doc(db, 'settings', 'global'), {
            photographerProfile: updatedProfile
          }, { merge: true });
          
          alert("Poza de profil a fost încărcată cu succes!");
        } catch (err) {
          console.error("Error saving avatar URL:", err);
          alert("Salvarea informațiilor despre avatar a eșuat.");
        } finally {
          setIsUploadingAvatar(false);
          setAvatarUploadProgress(null);
        }
      }
    );
  };

  const handleSaveProfile = async () => {
    try {
      const nameClean = profileNameInput.trim();
      const linkClean = profileLinkInput.trim();
      
      const updatedProfile = {
        name: nameClean || 'ALEXIA VISUAL ARTIST',
        link: linkClean,
        avatarUrl: photographerProfile?.avatarUrl || '',
        avatarPath: photographerProfile?.avatarPath || ''
      };
      
      await setDoc(doc(db, 'settings', 'global'), {
        photographerProfile: updatedProfile
      }, { merge: true });
      
      alert("Profilul fotografului a fost salvat cu succes!");
    } catch (err) {
      console.error("Error saving profile details:", err);
      alert("Salvarea profilului a eșuat.");
    }
  };

  const copyToClipboard = (text: string, id: string, type: 'config' | 'gallery' | 'public_gallery') => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId({ id, type });
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const getSchoolNameForLog = (classId: string) => {
    const matchedClass = classes.find(c => c.id === classId);
    return matchedClass ? `${matchedClass.schoolName} - ${matchedClass.diriginteName}` : 'Clasă necunoscută';
  };

  const getSubmissionsCount = (classId: string) => {
    return Object.values(submissions).filter(sub => sub.classId === classId).length;
  };

  return (
    <div className="admin-wrapper" data-theme="dark">
      {/* Sidebar / Header */}
      <header className="admin-header">
        <div className="header-logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/LOGO ALBUME.svg" alt="Alexia Graduation Albums Logo" style={{ height: '36px', width: 'auto' }} />
          <span className="admin-badge" style={{ margin: 0 }}>Admin</span>
        </div>
        <nav className="header-nav">
          <button 
            className={`nav-link ${activeTab === 'classes' ? 'active' : ''}`}
            onClick={() => { setActiveTab('classes'); setSelectedClass(null); }}
          >
            Albume Absolvenți
          </button>
          <button 
            className={`nav-link ${activeTab === 'galleries' ? 'active' : ''}`}
            onClick={() => { setActiveTab('galleries'); setSelectedClass(null); }}
          >
            Galerii Foto
          </button>
          <button 
            className={`nav-link ${activeTab === 'watermark' ? 'active' : ''}`}
            onClick={() => { setActiveTab('watermark'); setSelectedClass(null); }}
          >
            Watermark & Profil
          </button>
          <button 
            className={`nav-link ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Loguri Descărcare
          </button>
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          <LogOut size={16} /> Deconectare
        </button>
      </header>

      {/* Main Content */}
      <main className="admin-main">
        {error ? (
          <div className="dashboard-error">
            <AlertCircle size={48} className="text-danger" />
            <h3>Eroare conectare Firestore</h3>
            <p className="error-desc">{error}</p>
            <p className="error-help">
              Asigură-te că baza de date Cloud Firestore este activată în consola Firebase și că regulile de securitate permit accesul.
            </p>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>
              Reîncearcă
            </button>
          </div>
        ) : loading ? (
          <div className="dashboard-loading">
            <RefreshCw className="spinner" size={32} />
            <p>Se încarcă datele...</p>
          </div>
        ) : activeTab === 'classes' ? (
          <div className="dashboard-section">
            
            {selectedClass ? (
              /* DRILL DOWN: CLASS DIRECTORY VIEW */
              <div className="directory-view animate-fade">
                {/* Breadcrumbs & Navigation */}
                <div className="directory-breadcrumbs-row">
                  <div className="breadcrumbs">
                    <button className="breadcrumb-btn" onClick={() => setSelectedClass(null)}>
                      <Folder size={16} /> Clase
                    </button>
                    <ChevronRight size={14} className="breadcrumb-separator" />
                    <span className="breadcrumb-current">{selectedClass.schoolName}</span>
                  </div>
                  <button className="btn btn-secondary btn-back-root" onClick={() => setSelectedClass(null)}>
                    <ArrowLeft size={14} /> Înapoi la Clase
                  </button>
                </div>

                {/* Class Manager Info & Settings Block */}
                <div className="class-settings-card">
                  <div className="card-top-header">
                    <div>
                      <h2>{selectedClass.schoolName}</h2>
                      <p className="subtitle-teacher">Diriginte: <strong>{selectedClass.diriginteName}</strong></p>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <span className={`status-badge ${selectedClass.status}`}>
                        {selectedClass.status === 'active' ? 'Configurator Activ' : 'Configurator Blocat'}
                      </span>
                      {selectedClass.deadline && (
                        <span className={`status-badge ${new Date() > selectedClass.deadline.toDate() ? 'locked' : 'active'}`}>
                          {new Date() > selectedClass.deadline.toDate() ? 'Termen Depășit' : 'În Termen'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="settings-panel-grid">
                    <div className="settings-column">
                      <h4 className="settings-col-title">Link-uri Partajare</h4>
                      
                      <div className="link-field-wrapper">
                        <span className="field-label-text">Link Configurator Elevi</span>
                        <div className="field-input-row">
                          <input type="text" readOnly className="link-input-display" value={`${window.location.origin}/class/${selectedClass.id}`} />
                          <button 
                            className="action-icon-btn"
                            onClick={() => copyToClipboard(`${window.location.origin}/class/${selectedClass.id}`, selectedClass.id, 'config')}
                          >
                            {copiedId?.id === selectedClass.id && copiedId?.type === 'config' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                          </button>
                          <a href={`${window.location.origin}/class/${selectedClass.id}`} target="_blank" rel="noreferrer" className="action-icon-btn">
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>

                      <div className="link-field-wrapper" style={{ marginTop: '12px' }}>
                        <span className="field-label-text">Link Galerie Foto Finală</span>
                        <div className="field-input-row">
                          <input type="text" readOnly className="link-input-display" value={`${window.location.origin}/gallery/${selectedClass.id}`} />
                          <button 
                            className="action-icon-btn"
                            onClick={() => copyToClipboard(`${window.location.origin}/gallery/${selectedClass.id}`, selectedClass.id, 'gallery')}
                          >
                            {copiedId?.id === selectedClass.id && copiedId?.type === 'gallery' ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                          </button>
                          <a href={`${window.location.origin}/gallery/${selectedClass.id}`} target="_blank" rel="noreferrer" className="action-icon-btn">
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="settings-column">
                      <h4 className="settings-col-title">Setări & Parametri</h4>
                      
                      <div className="meta-params-list">
                        <div className="meta-param-item">
                          <span>Preț pagină extra:</span>
                          <strong>{selectedClass.extraPagesPrice} RON</strong>
                        </div>
                        <div className="meta-param-item">
                          <span>Termen Limită trimitere:</span>
                          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <Calendar size={13} /> 
                            {selectedClass.deadline 
                              ? selectedClass.deadline.toDate().toLocaleDateString('ro-RO')
                              : 'Fără termen limită'
                            }
                          </strong>
                        </div>
                        <div className="meta-param-item">
                          <span>Poze încărcate în galerie:</span>
                          <strong>{selectedClass.galleryPhotos?.length || 0} imagini</strong>
                        </div>
                      </div>

                      <div className="switches-row" style={{ marginTop: '16px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <button 
                          className={`toggle-action-btn ${selectedClass.status === 'active' ? 'btn-lock' : 'btn-unlock'}`}
                          onClick={() => toggleClassStatus(selectedClass.id, selectedClass.status)}
                          style={{ maxWidth: '240px' }}
                        >
                          {selectedClass.status === 'active' ? (
                            <><Lock size={14} /> Blochează configuratorul</>
                          ) : (
                            <><Unlock size={14} /> Activează configuratorul</>
                          )}
                        </button>

                        <label className="toggle-label-wrapper">
                          <input 
                            type="checkbox" 
                            checked={selectedClass.requireEmailDownload}
                            onChange={() => toggleEmailDownload(selectedClass.id, selectedClass.requireEmailDownload)}
                          />
                          <span className="toggle-custom-checkbox"></span>
                          <span className="toggle-text-span">Cere email la descărcare</span>
                        </label>

                        <button 
                          className="btn-delete-class"
                          onClick={() => deleteClass(selectedClass.id)}
                          style={{ 
                            marginLeft: 'auto', 
                            backgroundColor: '#2D1B1B', 
                            border: '1px solid #5A2B2B', 
                            color: '#FF6B6B', 
                            padding: '8px 16px', 
                            borderRadius: '4px', 
                            fontSize: '13px', 
                            fontWeight: 500, 
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            transition: 'all 0.2s'
                          }}
                          onMouseOver={(e) => { e.currentTarget.style.backgroundColor = '#4A1D1D'; }}
                          onMouseOut={(e) => { e.currentTarget.style.backgroundColor = '#2D1B1B'; }}
                        >
                          <Trash2 size={14} /> Șterge clasa
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Gallery Management section */}
                <div className="student-dossiers-wrapper" style={{ marginBottom: '32px' }}>
                  <div className="dossiers-header-row">
                    <h3>
                      <Folder size={20} className="logo-accent" style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      Gestionare Galerie Foto ({(selectedClass.galleryPhotos || []).length} poze)
                    </h3>
                    
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowAddPhotosForm(!showAddPhotosForm)}
                      disabled={isUploadingMore}
                    >
                      {showAddPhotosForm ? 'Închide upload' : 'Adaugă fotografii'}
                    </button>
                  </div>

                  {showAddPhotosForm && (
                    <div style={{ padding: '24px', backgroundColor: '#1C1A19', borderBottom: '1px solid #262423', borderTop: '1px solid #262423' }}>
                      {albumWatermark && (
                        <div style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#0E0D0C', padding: '12px', borderRadius: '4px', border: '1px solid #2D2A28' }}>
                          <input 
                            type="checkbox" 
                            id="apply-album-watermark-toggle-dash"
                            checked={applyAlbumWatermarkToggle} 
                            onChange={(e) => setApplyAlbumWatermarkToggle(e.target.checked)} 
                            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--gold-accent)' }}
                          />
                          <label htmlFor="apply-album-watermark-toggle-dash" style={{ margin: 0, fontSize: '13px', color: '#FAF9F6', cursor: 'pointer', fontWeight: 500 }}>
                            Aplică Watermark Album pe pozele adăugate
                          </label>
                        </div>
                      )}
                      <div className="upload-dropzone" style={{ border: '2px dashed #2D2A28', padding: '32px', textAlign: 'center', borderRadius: '6px', cursor: 'pointer', position: 'relative' }}>
                        {selectedClass.galleryType === 'folder' ? (
                          <input 
                            type="file" 
                            multiple 
                            {...({ webkitdirectory: '', directory: '' } as any)}
                            onChange={handleNewFilesUpload}
                            id="add-photos-input"
                            disabled={isUploadingMore}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                          />
                        ) : (
                          <input 
                            type="file" 
                            multiple 
                            accept="image/*"
                            onChange={handleNewFilesUpload}
                            id="add-photos-input"
                            disabled={isUploadingMore}
                            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                          />
                        )}
                        <FolderOpen size={32} style={{ color: 'var(--gold-accent)', marginBottom: '8px' }} />
                        <h4 style={{ color: '#FAF9F6', margin: '4px 0', fontSize: '14px' }}>
                          {selectedClass.galleryType === 'folder' ? 'Faceți click pentru a alege folderul de adăugat' : 'Faceți click pentru a alege poze de adăugat'}
                        </h4>
                        <p style={{ color: '#706E6A', fontSize: '12px' }}>
                          {selectedClass.galleryType === 'folder' ? 'Se vor încărca pozele structurate în subfoldere' : 'Sunt acceptate imagini JPG, PNG'}
                        </p>
                      </div>

                      {isUploadingMore && (
                        <div style={{ marginTop: '20px' }} className="progress-list">
                          <div className="upload-banner" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px', color: 'var(--gold-accent)' }}>
                            <RefreshCw className="spinner inline-icon" size={16} />
                            <span>Se încarcă pozele suplimentare... Te rugăm să aștepți.</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', padding: '8px', backgroundColor: '#161514', borderRadius: '4px' }}>
                            {Object.values(moreUploadProgress).map(p => (
                              <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: '#FAF9F6' }}>
                                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '240px' }}>{p.name}</span>
                                <span style={{ color: p.status === 'completed' ? '#2ECC71' : p.status === 'error' ? '#E74C3C' : 'var(--gold-accent)' }}>
                                  {p.status === 'completed' ? 'Finalizat' : p.status === 'error' ? 'Eroare' : `${p.progress}%`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="explorer-list" style={{ padding: '20px' }}>
                    {!(selectedClass.galleryPhotos && selectedClass.galleryPhotos.length > 0) ? (
                      <div style={{ textAlign: 'center', padding: '32px', color: '#706E6A' }}>
                        Nu există fotografii în galerie.
                      </div>
                    ) : selectedClass.galleryType === 'folder' ? (
                      // Grouped by folder representation
                      (() => {
                        const groups: Record<string, any[]> = {};
                        selectedClass.galleryPhotos.forEach(p => {
                          const f = p.folder || 'Fără folder';
                          if (!groups[f]) groups[f] = [];
                          groups[f].push(p);
                        });

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
                            {Object.entries(groups).map(([folderName, photos]) => (
                              <div key={folderName} style={{ border: '1px solid #262423', borderRadius: '6px', overflow: 'hidden', backgroundColor: '#161514' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderBottom: '1px solid #262423', backgroundColor: '#22201F' }}>
                                  <Folder size={16} style={{ color: 'var(--gold-accent)' }} />
                                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#FAF9F6' }}>{folderName}</span>
                                  <span style={{ fontSize: '11px', color: '#706E6A' }}>({photos.length} poze)</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '12px', padding: '16px' }}>
                                  {photos.map(photo => {
                                    const isDeleting = isDeletingPhoto === photo.path;
                                    return (
                                      <div key={photo.path} style={{ position: 'relative', aspectRatio: '1', borderRadius: '4px', overflow: 'hidden', border: '1px solid #2D2A28', backgroundColor: '#000' }}>
                                        <img src={photo.url} alt={photo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        <button 
                                          type="button"
                                          onClick={() => handleDeletePhoto(photo)}
                                          disabled={isDeleting}
                                          style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: 'rgba(217, 83, 79, 0.9)', border: 'none', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 5 }}
                                          title="Șterge imaginea"
                                        >
                                          {isDeleting ? <RefreshCw className="spinner" size={10} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={12} />}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    ) : (
                      // Flat simple grid representation
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '16px', width: '100%' }}>
                        {selectedClass.galleryPhotos.map(photo => {
                          const isDeleting = isDeletingPhoto === photo.path;
                          return (
                            <div key={photo.path} style={{ position: 'relative', aspectRatio: '1', borderRadius: '4px', overflow: 'hidden', border: '1px solid #2D2A28', backgroundColor: '#000' }}>
                              <img src={photo.url} alt={photo.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <button 
                                type="button"
                                onClick={() => handleDeletePhoto(photo)}
                                disabled={isDeleting}
                                style={{ position: 'absolute', top: '4px', right: '4px', width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'rgba(217, 83, 79, 0.9)', border: 'none', color: '#FFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 5 }}
                                title="Șterge imaginea"
                              >
                                {isDeleting ? <RefreshCw className="spinner" size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={14} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Submissions Folder Structure section */}
                <div className="student-dossiers-wrapper">
                  <div className="dossiers-header-row">
                    <h3>
                      <FolderOpen size={20} className="logo-accent" style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                      Dosarele Elevilor ({getSubmissionsCount(selectedClass.id)} trimise)
                    </h3>
                    
                    <div className="header-actions-row" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      {getSubmissionsCount(selectedClass.id) > 0 && (
                        <button 
                          className="btn btn-gold"
                          onClick={downloadClassZip}
                          disabled={classZipProgress !== null}
                          style={{ height: '36px', padding: '0 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                          {classZipProgress !== null ? (
                            <>Se descarcă ({classZipProgress}%)</>
                          ) : (
                            <><Download size={14} /> Descarcă toate albumele (ZIP)</>
                          )}
                        </button>
                      )}

                      <div className="search-bar-wrapper" style={{ padding: 0, width: '260px' }}>
                        <Search size={14} className="search-icon-admin" style={{ left: '12px' }} />
                        <input
                          type="text"
                          placeholder="Caută elev..."
                          value={searchStudentQuery}
                          onChange={(e) => setSearchStudentQuery(e.target.value)}
                          className="search-input-admin"
                          style={{ paddingLeft: '34px', height: '36px' }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="explorer-list">
                    {(() => {
                      const classSubmissions = Object.values(submissions).filter(sub => sub.classId === selectedClass.id);
                      
                      let dossiers: { name: string; hasSubmitted: boolean; submissionData: any }[] = [];
                      
                      if (selectedClass.studentList && selectedClass.studentList.length > 0) {
                        dossiers = selectedClass.studentList
                          .filter(name => name.toLowerCase().includes(searchStudentQuery.toLowerCase()))
                          .sort((a, b) => a.localeCompare(b))
                          .map(name => {
                            const sub = classSubmissions.find(s => s.studentName.toLowerCase() === name.toLowerCase());
                            return {
                              name,
                              hasSubmitted: !!sub,
                              submissionData: sub || null
                            };
                          });
                      } else {
                        // Fallback to only showing submissions for compatibility with old classes
                        dossiers = classSubmissions
                          .filter(sub => sub.studentName.toLowerCase().includes(searchStudentQuery.toLowerCase()))
                          .sort((a, b) => a.studentName.localeCompare(b.studentName))
                          .map(sub => ({
                            name: sub.studentName,
                            hasSubmitted: true,
                            submissionData: sub
                          }));
                      }

                      if (dossiers.length === 0) {
                        return (
                          <div className="dossier-empty-message" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', backgroundColor: '#1C1A19', border: '1px dashed #262423', borderRadius: '6px', width: '100%' }}>
                            <AlertCircle size={32} style={{ color: '#706E6A', marginBottom: '12px' }} />
                            <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Niciun dosar găsit</span>
                            <span style={{ color: '#706E6A', fontSize: '12px', marginTop: '4px', textAlign: 'center' }}>
                              Adăugați elevi în lista clasei pentru a le configura automat dosarele.
                            </span>
                          </div>
                        );
                      }

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                          {dossiers.map(({ name, hasSubmitted, submissionData }) => {
                            const isExpanded = expandedStudent === name;
                            const isDownloading = studentZipProgress[name] !== undefined;

                            return (
                              <div key={name} className={`explorer-row-item ${isExpanded ? 'expanded' : ''} ${hasSubmitted ? 'submitted' : 'pending'}`}>
                                {/* Row Header */}
                                <div 
                                  className="explorer-row-header"
                                  onClick={() => setExpandedStudent(isExpanded ? null : name)}
                                >
                                  <div className="explorer-item-title-section">
                                    {isExpanded ? (
                                      <ChevronDown size={16} className="arrow-exp" />
                                    ) : (
                                      <ChevronRight size={16} className="arrow-exp" />
                                    )}
                                    
                                    {hasSubmitted ? (
                                      <FolderOpen size={18} className="folder-icon-color submitted" />
                                    ) : (
                                      <FolderOpen size={18} className="folder-icon-color pending" style={{ color: '#706E6A' }} />
                                    )}

                                    <span className="explorer-student-name" style={{ color: hasSubmitted ? '#FAF9F6' : '#706E6A' }}>{name}</span>
                                  </div>

                                  <div className="explorer-item-badges">
                                    {hasSubmitted ? (
                                      <>
                                        <span className="sub-status-badge submitted">
                                          Complet / Trimis
                                        </span>
                                        {submissionData.extraPagesEnabled && (
                                          <span className="extra-pages-badge">Extra pagini</span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="sub-status-badge pending" style={{ backgroundColor: 'rgba(112, 110, 106, 0.1)', color: '#706E6A', border: '1px solid rgba(112, 110, 106, 0.2)' }}>
                                        În așteptare
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Collapsible Content */}
                                {isExpanded && (
                                  hasSubmitted ? (
                                    <div className="explorer-row-content">
                                      <div className="dossier-inner-grid">
                                        {/* Left side: details files text */}
                                        <div className="dossier-text-pane">
                                          <h5 className="dossier-section-title">Informații și Opțiuni</h5>
                                          
                                          <div className="dossier-meta-item">
                                            <span className="meta-label">Dată trimitere:</span>
                                            <span>{submissionData.submittedAt?.toDate ? submissionData.submittedAt.toDate().toLocaleString('ro-RO') : 'N/A'}</span>
                                          </div>

                                          {submissionData.citat && (
                                            <div className="dossier-meta-text-block">
                                              <span className="meta-label">Citat selectat:</span>
                                              <p className="citat-p-explore">„{submissionData.citat}”</p>
                                            </div>
                                          )}

                                          {submissionData.observatii && (
                                            <div className="dossier-meta-text-block" style={{ marginTop: '8px' }}>
                                              <span className="meta-label">Observații fotograf / designer:</span>
                                              <p className="observatii-p-explore">{submissionData.observatii}</p>
                                            </div>
                                          )}

                                          <div className="dossier-actions-footer" style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                                            <button 
                                              className="btn btn-gold btn-explore-action"
                                              onClick={() => setSelectedSubmission({ studentName: name, ...submissionData })}
                                              style={{ padding: '8px 16px', fontSize: '12px' }}
                                            >
                                              <Eye size={14} /> Vizualizează Poze
                                            </button>
                                            <button 
                                              className="btn btn-secondary btn-explore-action"
                                              onClick={() => downloadStudentZip(name, submissionData)}
                                              disabled={isDownloading}
                                              style={{ padding: '8px 16px', fontSize: '12px' }}
                                            >
                                              {isDownloading ? (
                                                <>Se descarcă ZIP ({studentZipProgress[name]}%)...</>
                                              ) : (
                                                <><Download size={14} /> Descarcă poze (ZIP)</>
                                              )}
                                            </button>
                                          </div>
                                        </div>

                                        {/* Right side: file structures list */}
                                        <div className="dossier-files-pane">
                                          <h5 className="dossier-section-title">Fișiere Selectate ({2 + (submissionData.personalPhotos?.length || 0) + (submissionData.extraPhotos?.length || 0)} fișiere)</h5>
                                          
                                          <ul className="dossier-files-list">
                                            <li className="dossier-file-item">
                                              <File size={14} className="file-icon-type" />
                                              <div className="dossier-file-details">
                                                <span className="file-category">Copertă:</span>
                                                <span className="file-name-text" title={submissionData.copertaPhoto.name || 'photo.jpg'}>{submissionData.copertaPhoto.name || 'photo.jpg'}</span>
                                                <span className={`badge-bw-inline ${submissionData.copertaPhoto.bw ? 'bw' : 'color'}`}>{submissionData.copertaPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                              </div>
                                            </li>
                                            <li className="dossier-file-item">
                                              <File size={14} className="file-icon-type" />
                                              <div className="dossier-file-details">
                                                <span className="file-category">Colegi:</span>
                                                <span className="file-name-text" title={submissionData.colegiPhoto.name || 'photo.jpg'}>{submissionData.colegiPhoto.name || 'photo.jpg'}</span>
                                                <span className={`badge-bw-inline ${submissionData.colegiPhoto.bw ? 'bw' : 'color'}`}>{submissionData.colegiPhoto.bw ? 'Alb-Negru' : 'Color'}</span>
                                              </div>
                                            </li>
                                            {submissionData.personalPhotos?.map((p: any, idx: number) => (
                                              <li key={idx} className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category">Personal {idx + 1}:</span>
                                                  <span className="file-name-text" title={p.name || 'photo.jpg'}>{p.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${p.bw ? 'bw' : 'color'}`}>{p.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            ))}
                                            {submissionData.extraPhotos?.map((p: any, idx: number) => (
                                              <li key={idx} className="dossier-file-item">
                                                <File size={14} className="file-icon-type" />
                                                <div className="dossier-file-details">
                                                  <span className="file-category" style={{ color: '#D8D0C8' }}>Extra {idx + 1}:</span>
                                                  <span className="file-name-text" title={p.name || 'photo.jpg'}>{p.name || 'photo.jpg'}</span>
                                                  <span className={`badge-bw-inline ${p.bw ? 'bw' : 'color'}`}>{p.bw ? 'Alb-Negru' : 'Color'}</span>
                                                </div>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="explorer-row-content pending" style={{ padding: '24px', textAlign: 'center', backgroundColor: '#1C1A19', borderTop: '1px solid #2D2A28' }}>
                                      <AlertCircle size={24} style={{ color: '#706E6A', marginBottom: '8px' }} />
                                      <p style={{ color: '#FAF9F6', fontSize: '13px', fontWeight: 500 }}>Acest elev nu și-a configurat încă albumul.</p>
                                      <p style={{ color: '#706E6A', fontSize: '11px', marginTop: '4px' }}>
                                        Trimiteți-i link-ul configuratorului pentru ca acesta să își poată alege fotografiile.
                                      </p>
                                    </div>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              /* CLASSES ROOT FOLDERS GRID VIEW */
              <div className="classes-root-explorer">
                <div className="section-header">
                  <div>
                    <h2>Clase & Fișiere Înregistrate</h2>
                    <p className="subtitle">Selectează un dosar de clasă pentru a vedea selecțiile elevilor</p>
                  </div>
                  <Link to="/admin/create-class" className="create-class-btn">
                    <Plus size={18} /> Creează Clasă Nouă
                  </Link>
                </div>

                <div className="search-bar-wrapper" style={{ padding: '0 0 24px 0', maxWidth: '400px' }}>
                  <Search size={16} className="search-icon-admin" style={{ left: '12px' }} />
                  <input
                    type="text"
                    placeholder="Caută clasă sau școală..."
                    value={searchClassQuery}
                    onChange={(e) => setSearchClassQuery(e.target.value)}
                    className="search-input-admin"
                    style={{ paddingLeft: '38px' }}
                  />
                </div>

                {classes.length === 0 ? (
                  <div className="empty-state">
                    <AlertCircle size={48} className="empty-icon" />
                    <h3>Nicio clasă înregistrată</h3>
                    <p>Creează prima ta clasă pentru a începe generarea link-urilor.</p>
                    <Link to="/admin/create-class" className="btn btn-gold" style={{ marginTop: '16px' }}>
                      Creează Clasă
                    </Link>
                  </div>
                ) : (
                  <div className="folders-explorer-grid">
                    {classes
                      .filter(c => c.schoolName.toLowerCase().includes(searchClassQuery.toLowerCase()) || c.diriginteName.toLowerCase().includes(searchClassQuery.toLowerCase()))
                      .map((cls) => {
                        const totalSubs = Object.values(submissions).filter(sub => sub.classId === cls.id).length;

                        return (
                          <div 
                            key={cls.id} 
                            className="folder-explorer-card"
                            onClick={() => { setSelectedClass(cls); setExpandedStudent(null); }}
                          >
                            <div className="folder-icon-wrapper">
                              <FolderOpen className="explorer-folder-icon" size={44} />
                            </div>

                            <div className="folder-info">
                              <h3 className="folder-school-title" title={cls.schoolName}>{cls.schoolName}</h3>
                              <span className="folder-teacher-span">Diriginte: {cls.diriginteName}</span>
                              
                              <div className="folder-progress-section" style={{ marginTop: '16px' }}>
                                <div className="progress-labels">
                                  <span>Albume trimise</span>
                                  <span><strong>{totalSubs}</strong> trimise</span>
                                </div>
                              </div>

                              {cls.deadline && (
                                <div className="folder-deadline-row" style={{ marginTop: '12px', fontSize: '11px', color: '#706E6A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <Calendar size={12} />
                                  <span>Limită: {cls.deadline.toDate().toLocaleDateString('ro-RO')}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : activeTab === 'galleries' ? (
          /* PHOTO GALLERIES TAB PANEL */
          <div className="dashboard-section animate-fade">
            <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>Galerii Foto</h2>
                <p className="subtitle">Gestionează galeriile foto publice cu watermark și foldere</p>
              </div>
              <button 
                onClick={() => {
                  setNewGallerySubtitle(photographerProfile?.name || 'ALEXIA VISUAL ARTIST');
                  setShowCreateGalleryModal(true);
                }} 
                className="btn btn-gold" 
                style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '10px 20px' }}
              >
                <Plus size={16} /> Creează Galerie Foto
              </button>
            </div>

            <div className="search-row" style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <div className="search-input-wrapper" style={{ flex: 1, display: 'flex', alignItems: 'center', backgroundColor: '#1C1A19', border: '1px solid #262423', padding: '10px 16px', borderRadius: '4px' }}>
                <Search size={18} style={{ color: '#706E6A', marginRight: '10px' }} />
                <input 
                  type="text" 
                  value={searchGalleryQuery}
                  onChange={(e) => setSearchGalleryQuery(e.target.value)}
                  placeholder="Caută galerie după titlu sau descriere..." 
                  style={{ flex: 1, background: 'none', border: 'none', color: '#FAF9F6', outline: 'none' }}
                />
              </div>
            </div>

            {galleriesError && (
              <div style={{ backgroundColor: 'rgba(224, 108, 117, 0.1)', border: '1px solid #E06C75', color: '#E06C75', padding: '16px', borderRadius: '4px', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }}>
                Eroare citire galerii din baza de date: {galleriesError}
              </div>
            )}

            {photoGalleries.filter(g => g.title?.toLowerCase().includes(searchGalleryQuery.toLowerCase())).length === 0 ? (
              <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center', backgroundColor: '#161514', borderRadius: '8px', border: '1px solid #262423' }}>
                <ImageIcon size={48} className="empty-icon" style={{ color: '#706E6A', marginBottom: '16px' }} />
                <h3>Nicio galerie foto găsită</h3>
                <p style={{ color: '#706E6A' }}>Adaugă prima ta galerie foto folosind butonul de mai sus.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '24px' }}>
                {photoGalleries
                  .filter(g => g.title?.toLowerCase().includes(searchGalleryQuery.toLowerCase()))
                  .map((gallery) => {
                    const totalPhotos = (gallery.subCollections || []).reduce((acc: number, sub: any) => acc + (sub.photos?.length || 0), 0);
                    const coverFocal = gallery.coverPhoto?.focalPoint || { x: 50, y: 50 };
                    
                    return (
                      <div key={gallery.id} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} className="gallery-collection-card">
                        
                        {/* Thumbnail Image Container with Hover Actions Overlay */}
                        <div 
                          style={{ 
                            position: 'relative', 
                            aspectRatio: '3/2', 
                            borderRadius: '6px', 
                            overflow: 'hidden', 
                            backgroundColor: '#1C1A19', 
                            border: '1px solid #262423'
                          }}
                          className="collection-image-container"
                        >
                          {gallery.coverPhoto ? (
                            <img 
                              src={gallery.coverPhoto.url} 
                              alt={gallery.title} 
                              style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${coverFocal.x}% ${coverFocal.y}%` }} 
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5C5A57' }}>
                              <ImageIcon size={32} />
                            </div>
                          )}

                          {/* Hover Actions Overlay */}
                          <div 
                            style={{ 
                              position: 'absolute', 
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              backgroundColor: 'rgba(18, 17, 16, 0.88)', 
                              display: 'flex', 
                              flexDirection: 'column', 
                              alignItems: 'center', 
                              justifyContent: 'center', 
                              gap: '10px',
                              opacity: 0,
                              transition: 'opacity 0.2s ease',
                              zIndex: 10,
                              boxSizing: 'border-box'
                            }}
                            className="collection-hover-overlay"
                          >
                            <Link 
                              to={`/admin/edit-photo-gallery/${gallery.id}`}
                              className="collection-hover-btn collection-hover-btn-gold" 
                              style={{ textDecoration: 'none' }}
                            >
                              <Settings size={13} /> Editează & Upload
                            </Link>

                            <a 
                              href={`${window.location.origin}/p-gallery/${gallery.id}`}
                              target="_blank" 
                              rel="noreferrer"
                              className="collection-hover-btn collection-hover-btn-outline"
                              style={{ textDecoration: 'none' }}
                            >
                              <ExternalLink size={13} /> Vizualizează
                            </a>

                            <button 
                              onClick={() => {
                                setDuplicateOptions({ cover: true, settings: true, folders: true, photos: true });
                                setDuplicatingGallery(gallery);
                              }}
                              className="collection-hover-btn collection-hover-btn-outline"
                            >
                              <Copy size={13} /> Duplică Galerie
                            </button>

                            <div style={{ display: 'flex', gap: '8px', width: '190px', boxSizing: 'border-box' }}>
                              <button 
                                onClick={() => copyToClipboard(`${window.location.origin}/p-gallery/${gallery.id}`, gallery.id, 'public_gallery')}
                                className="collection-hover-btn collection-hover-btn-outline"
                                style={{ flex: 1, padding: 0, width: 'auto' }}
                                title="Copiază link galerie"
                              >
                                {copiedId?.id === gallery.id && copiedId?.type === 'public_gallery' ? <Check size={14} style={{ color: '#2ECC71' }} /> : <Copy size={13} />}
                              </button>

                              <button 
                                onClick={() => handleDeleteGallery(gallery)}
                                className="collection-hover-btn collection-hover-btn-outline"
                                style={{ flex: 1, color: '#E06C75', borderColor: '#E06C75', padding: 0, width: 'auto' }}
                                title="Șterge galeria"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                        </div>

                        {/* Title and details below image */}
                        <div style={{ padding: '2px 4px' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#FAF9F6', margin: '0 0 4px 0', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {gallery.title || 'Galerie Fără Titlu'}
                          </h3>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#706E6A' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#2E7D32', display: 'inline-block' }} />
                            <span>{totalPhotos} imagini</span>
                            <span>•</span>
                            <span>{gallery.date || 'Fără Dată'}</span>
                          </div>
                        </div>

                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        ) : activeTab === 'watermark' ? (
          /* WATERMARK SETTINGS TAB PANEL */
          <div className="dashboard-section animate-fade" style={{ maxWidth: '850px', margin: '0 auto' }}>
            <div className="section-header">
              <h2>Setări Watermark & Profil</h2>
              <p className="subtitle">Gestionează watermark-urile pentru albume și galerii, ajustează-le poziția precis și configurează profilul de fotograf.</p>
            </div>

            <div className="student-dossiers-wrapper" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
              {watermarkError && (
                <div style={{ backgroundColor: 'rgba(224, 108, 117, 0.1)', border: '1px solid #E06C75', color: '#E06C75', padding: '12px', borderRadius: '4px', fontSize: '13px', textAlign: 'center' }}>
                  Eroare citire bază de date: {watermarkError}
                </div>
              )}

              {/* CARD 1: WATERMARK GALERII FOTO */}
              <div style={{ border: '1px solid #2D2A28', borderRadius: '8px', padding: '20px', backgroundColor: '#131211' }}>
                <h3 style={{ fontSize: '16px', color: '#FAF9F6', margin: '0 0 6px 0', fontWeight: 600 }}>Watermark Galerii Foto</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 20px 0' }}>Aplicat automat pe pozele încărcate în galeriile foto publice.</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {watermarkSettings ? (
                    <>
                      {/* Watermark Current display */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', fontSize: '12px' }}>
                        <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Fișier: {watermarkSettings.name}</span>
                        <button 
                          onClick={handleWatermarkDelete}
                          style={{ background: 'none', border: 'none', color: '#E06C75', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                        >
                          <Trash2 size={14} /> Șterge Fișier
                        </button>
                      </div>

                      <div style={{ padding: '16px', backgroundColor: '#0E0D0C', borderRadius: '6px', border: '1px solid #2D2A28', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
                        <img 
                          src={watermarkSettings.url} 
                          alt="Watermark Thumbnail" 
                          style={{ maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', opacity: 0.6 }} 
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ border: '2px dashed #2D2A28', padding: '30px 20px', borderRadius: '6px', textAlign: 'center', backgroundColor: '#0E0D0C', color: '#706E6A', fontSize: '13px' }}>
                      <ImageIcon size={32} style={{ marginBottom: '12px' }} />
                      <p style={{ margin: '0 0 8px 0' }}>Nu există niciun watermark configurat pentru galerii.</p>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #262423', paddingTop: '20px' }}>
                    <label className="field-label-text" style={{ fontSize: '12px', marginBottom: '8px' }}>Încarcă Watermark Nou Galerii (format PNG)</label>
                    <input 
                      type="file" 
                      accept="image/png"
                      onChange={handleWatermarkUpload}
                      id="gallery-watermark-input"
                      style={{ display: 'none' }}
                      disabled={isUploadingWatermark}
                    />
                    <button 
                      onClick={() => document.getElementById('gallery-watermark-input')?.click()}
                      className="btn btn-secondary"
                      disabled={isUploadingWatermark}
                      style={{ width: '100%', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isUploadingWatermark ? (
                        <>
                          <RefreshCw className="spinner" size={16} /> Se încarcă... ({watermarkUploadProgress}%)
                        </>
                      ) : (
                        <>
                          <Upload size={16} /> Încarcă Watermark PNG
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* CARD 2: WATERMARK ALBUME ABSOLVENȚI */}
              <div style={{ border: '1px solid #2D2A28', borderRadius: '8px', padding: '20px', backgroundColor: '#131211' }}>
                <h3 style={{ fontSize: '16px', color: '#FAF9F6', margin: '0 0 6px 0', fontWeight: 600 }}>Watermark Albume Absolvenți</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 20px 0' }}>Aplicat opțional pe pozele încărcate în albumele absolvenților (clase).</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {albumWatermark ? (
                    <>
                      {/* Album Watermark Current display */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', borderRadius: '6px', fontSize: '12px' }}>
                        <span style={{ color: '#FAF9F6', fontWeight: 500 }}>Fișier: {albumWatermark.name}</span>
                        <button 
                          onClick={handleAlbumWatermarkDelete}
                          style={{ background: 'none', border: 'none', color: '#E06C75', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}
                        >
                          <Trash2 size={14} /> Șterge Fișier
                        </button>
                      </div>

                      <div style={{ padding: '16px', backgroundColor: '#0E0D0C', borderRadius: '6px', border: '1px solid #2D2A28', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100px' }}>
                        <img 
                          src={albumWatermark.url} 
                          alt="Watermark Thumbnail" 
                          style={{ maxWidth: '100%', maxHeight: '60px', objectFit: 'contain', opacity: 0.6 }} 
                        />
                      </div>
                    </>
                  ) : (
                    <div style={{ border: '2px dashed #2D2A28', padding: '30px 20px', borderRadius: '6px', textAlign: 'center', backgroundColor: '#0E0D0C', color: '#706E6A', fontSize: '13px' }}>
                      <ImageIcon size={32} style={{ marginBottom: '12px' }} />
                      <p style={{ margin: '0 0 8px 0' }}>Nu există niciun watermark configurat pentru albume.</p>
                    </div>
                  )}

                  <div style={{ borderTop: '1px solid #262423', paddingTop: '20px' }}>
                    <label className="field-label-text" style={{ fontSize: '12px', marginBottom: '8px' }}>Încarcă Watermark Nou Albume (format PNG)</label>
                    <input 
                      type="file" 
                      accept="image/png"
                      onChange={handleAlbumWatermarkUpload}
                      id="album-watermark-input"
                      style={{ display: 'none' }}
                      disabled={isUploadingAlbumWatermark}
                    />
                    <button 
                      onClick={() => document.getElementById('album-watermark-input')?.click()}
                      className="btn btn-secondary"
                      disabled={isUploadingAlbumWatermark}
                      style={{ width: '100%', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isUploadingAlbumWatermark ? (
                        <>
                          <RefreshCw className="spinner" size={16} /> Se încarcă... ({albumWatermarkUploadProgress}%)
                        </>
                      ) : (
                        <>
                          <Upload size={16} /> Încarcă Watermark PNG
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Photographer Profile Configurator */}
              <div style={{ borderTop: '1px solid #262423', paddingTop: '24px', marginTop: '12px' }}>
                <h3 style={{ fontSize: '15px', color: '#FAF9F6', margin: '0 0 4px 0', fontWeight: 600 }}>Profil Fotograf</h3>
                <p style={{ color: '#706E6A', fontSize: '12px', margin: '0 0 16px 0' }}>Configurează avatarul și link-ul tău care vor fi afișate dinamic în antetul tuturor galeriilor tale foto.</p>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {/* Avatar Upload Block */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', padding: '16px', borderRadius: '6px' }}>
                    <div style={{ width: '64px', height: '64px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #363433', backgroundColor: '#1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {photographerProfile?.avatarUrl ? (
                        <img 
                          src={photographerProfile.avatarUrl} 
                          alt="Avatar" 
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        />
                      ) : (
                        <ImageIcon size={24} style={{ color: '#5C5A57' }} />
                      )}
                    </div>
                    
                    <div style={{ flex: 1 }}>
                      <input 
                        type="file" 
                        accept="image/*"
                        onChange={handleAvatarUpload}
                        id="avatar-file-input"
                        style={{ display: 'none' }}
                        disabled={isUploadingAvatar}
                      />
                      <button 
                        type="button"
                        onClick={() => document.getElementById('avatar-file-input')?.click()}
                        className="btn btn-secondary"
                        disabled={isUploadingAvatar}
                        style={{ fontSize: '12px', padding: '6px 12px', height: 'auto', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        {isUploadingAvatar ? (
                          <>
                            <RefreshCw className="spinner" size={13} /> Se încarcă... ({avatarUploadProgress}%)
                          </>
                        ) : (
                          <>
                            <Upload size={13} /> Schimbă poză profil
                          </>
                        )}
                      </button>
                      <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#5C5A57' }}>Recomandat: imagine pătrată, format JPG/PNG, maxim 500x500px.</p>
                    </div>
                  </div>

                  {/* Name field */}
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Nume Implicit Fotograf</label>
                    <input 
                      type="text" 
                      value={profileNameInput} 
                      onChange={(e) => setProfileNameInput(e.target.value)} 
                      placeholder="e.g. ALEXIA VISUAL ARTIST"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  {/* Redirection Link field */}
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Link Click-abil Profil (Instagram, Website, Facebook)</label>
                    <input 
                      type="text" 
                      value={profileLinkInput} 
                      onChange={(e) => setProfileLinkInput(e.target.value)} 
                      placeholder="e.g. https://instagram.com/alexiavisualartist"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  {/* Save button */}
                  <button 
                    onClick={handleSaveProfile}
                    className="btn btn-gold"
                    style={{ width: '100%', height: '44px', marginTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Salvează Profil Fotograf
                  </button>

                </div>
              </div>
            </div>
          </div>
        ) : (
          /* DOWNLOAD LOGS TAB PANEL */
          <div className="dashboard-section">
            <div className="section-header">
              <div>
                <h2>Istoric Descărcări</h2>
                <p className="subtitle">Urmărește cine a descărcat imagini din galeriile claselor</p>
              </div>
            </div>

            {downloadLogs.length === 0 ? (
              <div className="empty-state">
                <FileText size={48} className="empty-icon" />
                <h3>Niciun log de descărcare</h3>
                <p>Niciun utilizator nu a descărcat imagini până în acest moment.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Dată descărcare</th>
                      <th>Școală & Clasă</th>
                      <th>Email utilizator</th>
                      <th>Tip descărcare</th>
                      <th>Fișiere / Cantitate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {downloadLogs.map((log) => {
                      const date = log.downloadedAt?.toDate 
                        ? log.downloadedAt.toDate().toLocaleString('ro-RO')
                        : 'Dată necunoscută';

                      return (
                        <tr key={log.id}>
                          <td>{date}</td>
                          <td className="semibold-cell">{getSchoolNameForLog(log.classId)}</td>
                          <td className="email-cell">{log.email}</td>
                          <td>
                            <span className={`download-type-badge ${log.filesList.length > 1 ? 'zip' : 'single'}`}>
                              {log.filesList.length > 1 ? 'ZIP Archive' : 'Imagine Unică'}
                            </span>
                          </td>
                          <td className="files-cell" title={log.filesList.join(', ')}>
                            <Download size={14} className="inline-icon" /> {log.filesList.length} fișier(e)
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* 2. Student Submission Details Modal (Viewer Lightbox) */}
      {selectedSubmission && (
        <div className="admin-modal-overlay" style={{ zIndex: 1100 }}>
          <div className="admin-modal-card details-view-card">
            <div className="admin-modal-header">
              <div>
                <h3>Selecție Album: {selectedSubmission.studentName}</h3>
                <p className="admin-modal-subtitle">Configurat la: {selectedSubmission.submittedAt?.toDate ? selectedSubmission.submittedAt.toDate().toLocaleString('ro-RO') : 'N/A'}</p>
              </div>
              <button className="admin-modal-close" onClick={() => setSelectedSubmission(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="submission-scroll-details">
              {/* Cover & Classmates photos */}
              <div className="details-section">
                <h4>Fotografii Principale</h4>
                <div className="detail-photos-row">
                  <div className="detail-photo-card">
                    <span className="photo-type-label">Copertă</span>
                    <a href={selectedSubmission.copertaPhoto?.processedUrl || selectedSubmission.copertaPhoto?.url} target="_blank" rel="noreferrer">
                      <img 
                        src={selectedSubmission.copertaPhoto?.processedUrl || selectedSubmission.copertaPhoto?.url} 
                        alt="Coperta" 
                        className={selectedSubmission.copertaPhoto?.bw ? 'grayscale' : ''}
                      />
                    </a>
                    {selectedSubmission.copertaPhoto?.bw && <span className="bw-overlay-badge">B/W</span>}
                    <span className="detail-filename-label" title={selectedSubmission.copertaPhoto?.name}>{selectedSubmission.copertaPhoto?.name || 'Nespecificat'}</span>
                  </div>

                  <div className="detail-photo-card">
                    <span className="photo-type-label">Colegi</span>
                    <a href={selectedSubmission.colegiPhoto?.processedUrl || selectedSubmission.colegiPhoto?.url} target="_blank" rel="noreferrer">
                      <img 
                        src={selectedSubmission.colegiPhoto?.processedUrl || selectedSubmission.colegiPhoto?.url} 
                        alt="Colegi" 
                        className={selectedSubmission.colegiPhoto?.bw ? 'grayscale' : ''}
                      />
                    </a>
                    {selectedSubmission.colegiPhoto?.bw && <span className="bw-overlay-badge">B/W</span>}
                    <span className="detail-filename-label" title={selectedSubmission.colegiPhoto?.name}>{selectedSubmission.colegiPhoto?.name || 'Nespecificat'}</span>
                  </div>
                </div>
              </div>

              {/* Personal photos */}
              <div className="details-section">
                <h4>Fotografii Personale ({selectedSubmission.personalPhotos?.length || 0})</h4>
                <div className="detail-photo-grid">
                  {selectedSubmission.personalPhotos?.map((p: any, idx: number) => (
                    <div key={idx} className="detail-grid-card">
                      <a href={p.processedUrl || p.url} target="_blank" rel="noreferrer">
                        <img src={p.processedUrl || p.url} alt={`Personal ${idx}`} className={p.bw ? 'grayscale' : ''} />
                      </a>
                      {p.bw && <span className="bw-overlay-badge-small">B/W</span>}
                      <span className="detail-filename-label" title={p.name}>{p.name || 'photo.jpg'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quote & notes */}
              <div className="details-section">
                <h4>Informații Text Album</h4>
                <div className="admin-text-box">
                  <span className="photo-type-label">Nume dorit pe album (poreclă):</span>
                  <p className="notes-text-admin" style={{ fontStyle: 'normal', fontWeight: '600', fontSize: '14px', color: '#FAF9F6' }}>
                    {selectedSubmission.albumName || selectedSubmission.studentName}
                  </p>
                </div>
                {selectedSubmission.citat && (
                  <div className="admin-text-box" style={{ marginTop: '12px' }}>
                    <span className="photo-type-label">Citat:</span>
                    <p className="quote-text-admin">„{selectedSubmission.citat}”</p>
                  </div>
                )}
                {selectedSubmission.observatii && (
                  <div className="admin-text-box" style={{ marginTop: '12px' }}>
                    <span className="photo-type-label">Observații pentru designer:</span>
                    <p className="notes-text-admin">{selectedSubmission.observatii}</p>
                  </div>
                )}
              </div>

              {/* Extra Photos if enabled */}
              {selectedSubmission.extraPagesEnabled && selectedSubmission.extraPhotos && selectedSubmission.extraPhotos.length > 0 && (
                <div className="details-section">
                  <h4>Pagini Extra ({selectedSubmission.extraPhotos.length} poze)</h4>
                  <div className="detail-photo-grid">
                    {selectedSubmission.extraPhotos.map((p: any, idx: number) => (
                      <div key={idx} className="detail-grid-card">
                        <a href={p.processedUrl || p.url} target="_blank" rel="noreferrer">
                          <img src={p.processedUrl || p.url} alt={`Extra ${idx}`} className={p.bw ? 'grayscale' : ''} />
                        </a>
                        {p.bw && <span className="bw-overlay-badge-small">B/W</span>}
                        <span className="detail-filename-label" title={p.name}>{p.name || 'photo.jpg'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedSubmission(null)}>Înapoi</button>
            </div>
          </div>
        </div>
      )}

      {/* Duplication Modal */}
      {duplicatingGallery && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-container" style={{ maxWidth: '480px', backgroundColor: '#161514', border: '1px solid #262423' }}>
            <div className="admin-modal-header" style={{ borderBottom: '1px solid #262423', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#FAF9F6' }}>Duplicare Galerie</h3>
              <button 
                onClick={() => !isDuplicating && setDuplicatingGallery(null)} 
                style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                disabled={isDuplicating}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="admin-modal-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {isDuplicating ? (
                <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <RefreshCw className="spinner" size={32} style={{ color: 'var(--gold-accent)', marginBottom: '16px' }} />
                  <h4 style={{ color: '#FAF9F6', margin: '0 0 8px 0' }}>Se duplică galeria...</h4>
                  <p style={{ color: '#706E6A', fontSize: '13px', margin: '6px 0 0 0' }}>
                    Copiere fișiere: {duplicateProgress.current} / {duplicateProgress.total} finalizate.
                  </p>
                  <div style={{ width: '100%', height: '6px', backgroundColor: '#0E0D0C', borderRadius: '3px', marginTop: '16px', overflow: 'hidden' }}>
                    <div 
                      style={{ 
                        height: '100%', 
                        backgroundColor: 'var(--gold-accent)', 
                        width: `${duplicateProgress.total > 0 ? (duplicateProgress.current / duplicateProgress.total) * 100 : 100}%`,
                        transition: 'width 0.2s ease'
                      }} 
                    />
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ color: '#A3A09B', fontSize: '13px', margin: 0, lineHeight: 1.4 }}>
                    Alege tipul de duplicare sau selectează elementele specifice pe care dorești să le incluzi în copia galeriei:
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: '#0E0D0C', padding: '14px', borderRadius: '6px', border: '1px solid #262423', marginTop: '4px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.cover} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, cover: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Imagine Copertă & Detalii Copertă
                    </label>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.settings} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, settings: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Setări Watermark & Tipografie
                    </label>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#FAF9F6', fontSize: '13px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={duplicateOptions.folders} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, folders: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Structură Foldere / Sub-colecții
                    </label>

                    <label 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px', 
                        color: duplicateOptions.folders ? '#FAF9F6' : '#5C5A57', 
                        fontSize: '13px', 
                        cursor: duplicateOptions.folders ? 'pointer' : 'not-allowed',
                        paddingLeft: '16px'
                      }}
                    >
                      <input 
                        type="checkbox" 
                        disabled={!duplicateOptions.folders}
                        checked={duplicateOptions.folders && duplicateOptions.photos} 
                        onChange={(e) => setDuplicateOptions(prev => ({ ...prev, photos: e.target.checked }))}
                        style={{ accentColor: 'var(--gold-accent)' }}
                      />
                      Copiază și fotografiile din foldere
                    </label>
                  </div>
                </>
              )}
            </div>

            {!isDuplicating && (
              <div className="admin-modal-footer" style={{ borderTop: '1px solid #262423', gap: '8px', display: 'flex', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <button className="btn btn-secondary" onClick={() => setDuplicatingGallery(null)} style={{ padding: '8px 16px', fontSize: '12px' }}>
                  Anulează
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => handleExecuteDuplicate(duplicatingGallery, false)} 
                  style={{ padding: '8px 16px', fontSize: '12px', border: '1px solid var(--gold-accent)', color: 'var(--gold-accent)' }}
                >
                  Duplicare Personalizată
                </button>
                <button 
                  className="btn btn-gold" 
                  onClick={() => handleExecuteDuplicate(duplicatingGallery, true)} 
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                >
                  Duplicare Rapidă (Tot)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create New Gallery Modal */}
      {showCreateGalleryModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-container" style={{ maxWidth: '520px', backgroundColor: '#161514', border: '1px solid #262423' }}>
            <div className="admin-modal-header" style={{ borderBottom: '1px solid #262423', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', color: '#FAF9F6', fontWeight: 600 }}>Creează Galerie Foto Nouă</h3>
              <button 
                onClick={() => !isCreatingGallery && setShowCreateGalleryModal(false)} 
                style={{ background: 'none', border: 'none', color: '#706E6A', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
                disabled={isCreatingGallery}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="admin-modal-body" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {isCreatingGallery ? (
                <div style={{ textAlign: 'center', padding: '40px 10px' }}>
                  <RefreshCw className="spinner" size={32} style={{ color: 'var(--gold-accent)', marginBottom: '16px' }} />
                  <h4 style={{ color: '#FAF9F6', margin: '0 0 8px 0' }}>Se inițializează galeria...</h4>
                  <p style={{ color: '#706E6A', fontSize: '13px', margin: 0 }}>
                    Vă rugăm să așteptați. Se creează galeria în Firestore...
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Nume Galerie (Ex: Denis & Dominika)</label>
                    <input 
                      type="text" 
                      value={newGalleryTitle} 
                      onChange={(e) => setNewGalleryTitle(e.target.value)} 
                      placeholder="e.g. Denis & Dominika"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  <div>
                    <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Subtitlu Copertă (Ex: Alexia Visual Artist)</label>
                    <input 
                      type="text" 
                      value={newGallerySubtitle} 
                      onChange={(e) => setNewGallerySubtitle(e.target.value)} 
                      placeholder="e.g. ALEXIA VISUAL ARTIST"
                      style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '14px', outline: 'none' }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Data Evenimentului</label>
                      <input 
                        type="date" 
                        value={newGalleryDate} 
                        onChange={(e) => setNewGalleryDate(e.target.value)}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', height: '42px' }}
                      />
                    </div>

                    <div>
                      <label className="field-label-text" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#706E6A', display: 'block', marginBottom: '8px' }}>Aplică Watermark implicit?</label>
                      <select 
                        value={newGalleryWatermark ? 'yes' : 'no'}
                        onChange={(e) => setNewGalleryWatermark(e.target.value === 'yes')}
                        style={{ width: '100%', padding: '10px 12px', backgroundColor: '#0E0D0C', border: '1px solid #2D2A28', color: '#FAF9F6', borderRadius: '4px', fontSize: '13px', outline: 'none', height: '42px' }}
                      >
                        <option value="no">Nu aplica</option>
                        <option value="yes">Da, aplică watermark implicit</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!isCreatingGallery && (
              <div className="admin-modal-footer" style={{ borderTop: '1px solid #262423', gap: '8px', display: 'flex', justifyContent: 'flex-end', padding: '16px 20px' }}>
                <button className="btn btn-secondary" onClick={() => setShowCreateGalleryModal(false)} style={{ padding: '8px 16px', fontSize: '12px' }}>
                  Anulează
                </button>
                <button 
                  className="btn btn-gold" 
                  onClick={handleExecuteCreateGallery} 
                  style={{ padding: '8px 16px', fontSize: '12px' }}
                  disabled={!newGalleryTitle.trim()}
                >
                  Creează Galerie & Continuă
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        .collection-image-container:hover .collection-hover-overlay {
          opacity: 1 !important;
        }
        .gallery-collection-card:hover .collection-image-container img {
          transform: scale(1.03);
        }
        .collection-image-container img {
          transition: transform 0.3s ease;
        }

        .collection-hover-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 190px;
          height: 36px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          cursor: pointer;
          border: none;
          transition: all 0.2s ease;
          padding: 0 12px;
          box-sizing: border-box;
          font-family: 'Outfit', sans-serif;
        }
        .collection-hover-btn-gold {
          background-color: var(--gold-accent);
          color: #FAF9F6;
        }
        .collection-hover-btn-gold:hover {
          background-color: var(--gold-hover);
          transform: translateY(-1px);
        }
        .collection-hover-btn-outline {
          background-color: rgba(18, 17, 16, 0.6);
          color: #FAF9F6;
          border: 1px solid #706E6A;
        }
        .collection-hover-btn-outline:hover {
          background-color: #FAF9F6;
          color: #121110;
          border-color: #FAF9F6;
        }

        .admin-wrapper {
          min-height: 100vh;
          background-color: #0E0D0C;
          color: #F5F4F0;
          font-family: 'Outfit', sans-serif;
          display: flex;
          flex-direction: column;
        }

        /* Header Style */
        .admin-header {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 40px;
          background-color: #161514;
          border-bottom: 1px solid #262423;
          height: 70px;
        }

        .header-logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-sans);
          font-size: 20px;
          font-weight: 600;
          letter-spacing: 0.05em;
        }

        .logo-accent {
          color: var(--gold-accent);
        }

        .admin-badge {
          font-family: 'Outfit', sans-serif;
          font-size: 10px;
          background-color: #2D2A28;
          color: #D8D0C8;
          padding: 2px 6px;
          border-radius: 4px;
          vertical-align: middle;
          margin-left: 6px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .header-nav {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 8px;
        }

        .nav-link {
          background: none;
          border: none;
          color: #A3A09B;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .nav-link:hover {
          color: #F5F4F0;
          background-color: #22201F;
        }

        .nav-link.active {
          color: #D8D0C8;
          background-color: var(--gold-accent);
        }

        .logout-btn {
          background: none;
          border: 1px solid #262423;
          color: #A3A09B;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s ease;
        }

        .logout-btn:hover {
          color: #E06C75;
          border-color: rgba(224, 108, 117, 0.4);
          background-color: rgba(224, 108, 117, 0.05);
        }

        /* Main Section */
        .admin-main {
          flex: 1;
          padding: 40px;
          max-width: 1400px;
          width: 100%;
          margin: 0 auto;
        }

        .dashboard-section {
          animation: fadeIn 0.4s ease;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .section-header h2 {
          font-size: 28px;
          font-weight: 400;
          margin-bottom: 4px;
        }

        .create-class-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 12px 20px;
          background-color: var(--gold-accent);
          color: #D8D0C8;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(197, 168, 128, 0.15);
        }

        .create-class-btn:hover {
          transform: translateY(-1px);
          opacity: 0.95;
        }

        /* Folders Explorer Style */
        .folders-explorer-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
          margin-top: 16px;
        }

        .folder-explorer-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          padding: 24px;
          display: flex;
          align-items: flex-start;
          gap: 20px;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .folder-explorer-card:hover {
          transform: translateY(-2px);
          border-color: var(--gold-accent);
          box-shadow: 0 8px 24px rgba(197, 168, 128, 0.08);
        }

        .folder-icon-wrapper {
          color: var(--gold-accent);
          margin-top: 2px;
          background-color: rgba(197, 168, 128, 0.05);
          padding: 12px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .folder-info {
          flex: 1;
          overflow: hidden;
        }

        .folder-school-title {
          font-size: 18px;
          font-weight: 500;
          margin-bottom: 4px;
          color: #FAF9F6;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .folder-teacher-span {
          font-size: 12px;
          color: #A3A09B;
        }

        .folder-progress-section {
          width: 100%;
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: #706E6A;
          margin-bottom: 6px;
        }

        .progress-bar-container {
          height: 6px;
          background-color: #2D2A28;
          border-radius: 3px;
          overflow: hidden;
          width: 100%;
        }

        .progress-bar-fill {
          height: 100%;
          background-color: var(--gold-accent);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        /* Directory Drill Down View */
        .directory-breadcrumbs-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }

        .breadcrumbs {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .breadcrumb-btn {
          background: none;
          border: none;
          color: #A3A09B;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: color 0.15s;
        }

        .breadcrumb-btn:hover {
          color: #F5F4F0;
        }

        .breadcrumb-separator {
          color: #706E6A;
        }

        .breadcrumb-current {
          color: #D8D0C8;
          font-size: 14px;
          font-weight: 500;
        }

        .btn-back-root {
          padding: 8px 16px;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        /* Class Settings Header Panel */
        .class-settings-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 32px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.15);
        }

        .card-top-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid #262423;
          padding-bottom: 16px;
          margin-bottom: 16px;
        }

        .card-top-header h2 {
          font-size: 24px;
          font-weight: 400;
          color: #FAF9F6;
          margin-bottom: 4px;
        }

        .subtitle-teacher {
          font-size: 13px;
          color: #A3A09B;
        }

        .settings-panel-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 32px;
        }

        @media (max-width: 800px) {
          .settings-panel-grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }

        .settings-column {
          display: flex;
          flex-direction: column;
        }

        .settings-col-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #706E6A;
          margin-bottom: 12px;
          font-weight: 600;
        }

        .link-field-wrapper {
          width: 100%;
        }

        .field-label-text {
          font-size: 10px;
          color: #A3A09B;
          display: block;
          margin-bottom: 4px;
        }

        .field-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background-color: #0E0D0C;
          border: 1px solid #2D2A28;
          padding: 6px 10px;
          border-radius: 4px;
        }

        .field-input-row input {
          flex: 1;
          background: none;
          border: none;
          color: #FAF9F6;
          font-size: 11px;
          font-family: monospace;
          outline: none;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .meta-params-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .meta-param-item {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #A3A09B;
          border-bottom: 1px dashed #262423;
          padding-bottom: 6px;
        }

        .meta-param-item strong {
          color: #FAF9F6;
        }

        .toggle-action-btn {
          flex: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 600;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s ease;
          border: none;
        }

        .btn-lock {
          background-color: rgba(224, 108, 117, 0.1);
          color: #E06C75;
          border: 1px solid rgba(224, 108, 117, 0.2);
        }

        .btn-lock:hover {
          background-color: rgba(224, 108, 117, 0.2);
        }

        .btn-unlock {
          background-color: rgba(152, 195, 121, 0.1);
          color: #98C379;
          border: 1px solid rgba(152, 195, 121, 0.2);
        }

        .btn-unlock:hover {
          background-color: rgba(152, 195, 121, 0.2);
        }

        /* Toggle checkbox styles */
        .toggle-label-wrapper {
          display: inline-flex;
          align-items: center;
          cursor: pointer;
          user-select: none;
          font-size: 12px;
          color: #A3A09B;
          gap: 8px;
        }

        .toggle-label-wrapper input {
          position: absolute;
          opacity: 0;
          cursor: pointer;
          height: 0;
          width: 0;
        }

        .toggle-custom-checkbox {
          position: relative;
          height: 16px;
          width: 30px;
          background-color: #2D2A28;
          border-radius: 10px;
          transition: background-color 0.2s ease;
        }

        .toggle-custom-checkbox::before {
          content: "";
          position: absolute;
          height: 12px;
          width: 12px;
          left: 2px;
          bottom: 2px;
          background-color: #706E6A;
          border-radius: 50%;
          transition: transform 0.2s ease, background-color 0.2s;
        }

        .toggle-label-wrapper input:checked ~ .toggle-custom-checkbox {
          background-color: var(--gold-accent);
        }

        .toggle-label-wrapper input:checked ~ .toggle-custom-checkbox::before {
          transform: translateX(14px);
          background-color: #121110;
        }

        /* Dossiers Section list */
        .student-dossiers-wrapper {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          padding: 24px;
        }

        .dossiers-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          border-bottom: 1px solid #262423;
          padding-bottom: 16px;
        }

        .dossiers-header-row h3 {
          font-size: 18px;
          font-weight: 500;
          color: #FAF9F6;
        }

        .explorer-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .explorer-row-item {
          background-color: #1C1A19;
          border: 1px solid #262423;
          border-radius: 6px;
          overflow: hidden;
          transition: all 0.2s;
        }

        .explorer-row-item.expanded {
          border-color: var(--gold-accent);
        }

        .explorer-row-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 20px;
          cursor: pointer;
          user-select: none;
        }

        .explorer-row-header:hover {
          background-color: #22201F;
        }

        .explorer-item-title-section {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .arrow-exp {
          color: #706E6A;
        }

        .folder-icon-color.submitted {
          color: var(--gold-accent);
        }

        .folder-icon-color.pending {
          color: #706E6A;
        }

        .explorer-student-name {
          font-size: 14px;
          font-weight: 500;
          color: #FAF9F6;
        }

        .explorer-item-badges {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .extra-pages-badge {
          background-color: rgba(197, 168, 128, 0.1);
          border: 1px solid rgba(197, 168, 128, 0.2);
          color: var(--gold-accent);
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .explorer-row-content {
          border-top: 1px solid #262423;
          background-color: #0F0E0D;
          padding: 20px;
          animation: fadeIn 0.2s ease-out;
        }

        .dossier-inner-grid {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 32px;
        }

        @media (max-width: 800px) {
          .dossier-inner-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }
        }

        .dossier-section-title {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #706E6A;
          margin-bottom: 12px;
          font-weight: 600;
          border-bottom: 1px solid #262423;
          padding-bottom: 4px;
        }

        .dossier-meta-item {
          display: flex;
          font-size: 13px;
          gap: 8px;
          color: #A3A09B;
          margin-bottom: 10px;
        }

        .meta-label {
          color: #706E6A;
          font-weight: 500;
        }

        .dossier-meta-text-block {
          background-color: #161514;
          border: 1px solid #22201F;
          padding: 12px;
          border-radius: 4px;
          font-size: 13px;
        }

        .citat-p-explore {
          font-family: var(--font-sans);
          font-style: italic;
          color: #FAF9F6;
          margin-top: 4px;
        }

        .observatii-p-explore {
          color: #FAF9F6;
          margin-top: 4px;
        }

        .dossier-files-pane {
          display: flex;
          flex-direction: column;
        }

        .dossier-files-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 240px;
          overflow-y: auto;
        }

        .dossier-file-item {
          display: flex;
          align-items: center;
          gap: 10px;
          background-color: #161514;
          border: 1px solid #22201F;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
        }

        .dossier-file-item.extra-file {
          background-color: rgba(197, 168, 128, 0.02);
          border-color: rgba(197, 168, 128, 0.1);
        }

        .file-icon-type {
          color: #706E6A;
        }

        .dossier-file-details {
          flex: 1;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          overflow: hidden;
        }

        .file-category {
          color: #706E6A;
          font-weight: 500;
        }

        .file-name-text {
          flex: 1;
          color: #FAF9F6;
          font-family: monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .badge-bw-inline {
          font-size: 9px;
          padding: 1px 6px;
          border-radius: 3px;
          font-weight: 600;
        }

        .badge-bw-inline.bw {
          background-color: #000000;
          color: #FFFFFF;
          border: 1px solid #3E3B39;
        }

        .badge-bw-inline.color {
          background-color: rgba(95, 11, 2, 0.25);
          color: #D8D0C8;
        }

        .dossier-empty-message {
          display: flex;
          align-items: center;
          color: #706E6A;
          font-size: 13px;
          padding: 12px;
          background-color: #161514;
          border: 1px dashed #262423;
          border-radius: 6px;
        }

        /* Logs Table Section */
        .table-responsive {
          width: 100%;
          overflow-x: auto;
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 14px;
        }

        .logs-table th, .logs-table td {
          padding: 16px 24px;
          border-bottom: 1px solid #262423;
        }

        .logs-table th {
          background-color: #1C1A19;
          font-weight: 600;
          color: #A3A09B;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .logs-table tr:last-child td {
          border-bottom: none;
        }

        .logs-table tr:hover td {
          background-color: #1C1A19;
        }

        .semibold-cell {
          font-weight: 500;
          color: #FAF9F6;
        }

        .email-cell {
          color: var(--gold-accent);
          font-family: monospace;
        }

        .download-type-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
        }

        .download-type-badge.zip {
          background-color: rgba(197, 168, 128, 0.15);
          color: var(--gold-accent);
        }

        .download-type-badge.single {
          background-color: #2D2A28;
          color: #FAF9F6;
        }

        .files-cell {
          color: #A3A09B;
        }

        .inline-icon {
          vertical-align: middle;
          margin-right: 4px;
        }

        /* Loading & Empty States */
        .dashboard-loading, .dashboard-error {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 24px;
          gap: 16px;
          color: #A3A09B;
          text-align: center;
        }

        .dashboard-error h3 {
          font-size: 22px;
          color: #FAF9F6;
          font-weight: 500;
        }

        .error-desc {
          color: #E06C75;
          font-family: monospace;
          background-color: rgba(224, 108, 117, 0.05);
          padding: 8px 16px;
          border: 1px dashed rgba(224, 108, 117, 0.2);
          border-radius: 4px;
          font-size: 13px;
          max-width: 500px;
        }

        .error-help {
          font-size: 13px;
          color: #706E6A;
          max-width: 400px;
          margin-bottom: 8px;
        }

        /* Admin Modals */
        .admin-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background-color: rgba(14, 13, 12, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .admin-modal-card {
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 8px;
          width: 100%;
          max-width: 580px;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 20px 50px rgba(0,0,0,0.5);
          overflow: hidden;
        }

        .admin-modal-card.details-view-card {
          max-width: 800px;
        }

        .admin-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid #262423;
          background-color: #1C1A19;
        }

        .admin-modal-header h3 {
          font-size: 18px;
          font-weight: 500;
          color: #FAF9F6;
        }

        .admin-modal-subtitle {
          font-size: 12px;
          color: #A3A09B;
        }

        .admin-modal-close {
          background: none;
          border: none;
          color: #706E6A;
          cursor: pointer;
          transition: color 0.15s;
        }

        .admin-modal-close:hover {
          color: #FAF9F6;
        }

        .search-bar-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon-admin {
          position: absolute;
          color: #706E6A;
          pointer-events: none;
        }

        .search-input-admin {
          width: 100%;
          padding: 10px 16px 10px 40px;
          background-color: #0E0D0C;
          border: 1px solid #262423;
          border-radius: 4px;
          color: #FAF9F6;
          font-size: 13px;
          outline: none;
          transition: border-color 0.2s;
        }

        .search-input-admin:focus {
          border-color: var(--gold-accent);
        }

        .sub-status-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .sub-status-badge.submitted {
          background-color: rgba(95, 11, 2, 0.25);
          color: #D8D0C8;
        }

        .sub-status-badge.pending {
          background-color: rgba(112, 110, 106, 0.15);
          color: #A3A09B;
        }

        .admin-modal-footer {
          padding: 16px 24px;
          border-top: 1px solid #262423;
          display: flex;
          justify-content: flex-end;
          background-color: #1C1A19;
        }

        /* Detail viewer styles */
        .submission-scroll-details {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          background-color: #0E0D0C;
        }

        .details-section h4 {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #A3A09B;
          margin-bottom: 12px;
          font-weight: 600;
          border-left: 2px solid var(--gold-accent);
          padding-left: 8px;
        }

        .detail-photos-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .detail-photo-card {
          background-color: #161514;
          border: 1px solid #262423;
          padding: 12px;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          position: relative;
        }

        .detail-photo-card img {
          width: 100%;
          height: 180px;
          object-fit: cover;
          border-radius: 4px;
        }

        .detail-photo-card img.grayscale,
        .detail-grid-card img.grayscale {
          filter: grayscale(100%);
        }

        .photo-type-label {
          font-size: 11px;
          text-transform: uppercase;
          color: #706E6A;
          margin-bottom: 6px;
          font-weight: 500;
        }

        .bw-overlay-badge {
          position: absolute;
          top: 36px;
          right: 20px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
        }

        .detail-photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 16px;
        }

        .detail-grid-card {
          position: relative;
          aspect-ratio: 3/4;
          background-color: #161514;
          border: 1px solid #262423;
          border-radius: 6px;
          padding: 6px;
          display: flex;
          flex-direction: column;
        }

        .detail-grid-card img {
          width: 100%;
          flex: 1;
          object-fit: cover;
          border-radius: 4px;
        }

        .bw-overlay-badge-small {
          position: absolute;
          top: 12px;
          right: 12px;
          background-color: #000000;
          color: #FFFFFF;
          font-size: 8px;
          font-weight: 600;
          padding: 1px 4px;
          border-radius: 3px;
        }

        .detail-filename-label {
          display: block;
          font-size: 10px;
          font-family: monospace;
          color: #706E6A;
          margin-top: 6px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          width: 100%;
          text-align: center;
        }

        .detail-photo-card .detail-filename-label {
          margin-top: 8px;
        }

        .admin-text-box {
          background-color: #161514;
          border: 1px solid #262423;
          padding: 16px;
          border-radius: 6px;
        }

        .quote-text-admin {
          font-family: var(--font-sans);
          font-style: italic;
          color: #FAF9F6;
          font-size: 15px;
          margin-top: 4px;
        }

        .notes-text-admin {
          font-size: 13px;
          color: #FAF9F6;
          margin-top: 4px;
        }

        .spinner {
          animation: spin 1s linear infinite;
          color: var(--gold-accent);
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 80px 40px;
          text-align: center;
          background-color: #161514;
          border: 1px dashed #262423;
          border-radius: 8px;
          width: 100%;
        }

        .empty-icon {
          color: #706E6A;
          margin-bottom: 16px;
        }

        .empty-state h3 {
          font-size: 20px;
          font-weight: 400;
          margin-bottom: 8px;
          color: #FAF9F6;
        }

        .empty-state p {
          color: #A3A09B;
          font-size: 14px;
          max-width: 400px;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .directory-view {
          animation: fadeIn 0.3s ease;
        }
      `}</style>
    </div>
  );
};
